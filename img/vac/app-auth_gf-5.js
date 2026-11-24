/* Резерв ID — доступ/підписка.
   Модель:
     • Підписка (на сервері) — єдина правда про доступ.
     • deviceToken — секрет пристрою, який видає сервер при прив'язці. Один активний
       пристрій на акаунт (сервер відкликає попередній при новій прив'язці).
     • Код входу (pin) — ЛОКАЛЬНИЙ замок екрана. Приходить у пакеті з сервера,
       тож завжди актуальний після sync. Він не гейтить доступ до сервера.
   Локального шифрування немає: дані кешуються відкрито, доступ тримає токен+підписка. */
(function(){
'use strict';

/* ---------- IndexedDB (просте kv-сховище) ---------- */
var DB='rid', STORE='kv', _db=null;
function db(){
  return _db ? Promise.resolve(_db) : new Promise(function(res,rej){
    var r=indexedDB.open(DB,1);
    r.onupgradeneeded=function(){r.result.createObjectStore(STORE);};
    r.onsuccess=function(){_db=r.result;res(_db);};
    r.onerror=function(){rej(r.error);};
  });
}
function idbGet(k){return db().then(function(d){return new Promise(function(res,rej){
  var r=d.transaction(STORE,'readonly').objectStore(STORE).get(k);
  r.onsuccess=function(){res(r.result);};r.onerror=function(){rej(r.error);};});});}
function idbSet(k,v){return db().then(function(d){return new Promise(function(res,rej){
  var t=d.transaction(STORE,'readwrite');t.objectStore(STORE).put(v,k);
  t.oncomplete=function(){res();};t.onerror=function(){rej(t.error);};});});}
function idbClear(){return db().then(function(d){return new Promise(function(res,rej){
  var t=d.transaction(STORE,'readwrite');t.objectStore(STORE).clear();
  t.oncomplete=function(){res();};t.onerror=function(){rej(t.error);};});});}

/* ============================================================
   МОК-СЕРВЕР (тимчасовий, для локального тесту без бекенда).
   Живе у localStorage['rid_srv']. Ті самі сигнатури, що й HTTP API.
   ============================================================ */
var DEFAULT_CONFIG={
  name:['ПРІЗВИЩЕ','ІМ\'Я','По батькові'], status:'Статус обліку',
  photo:'', defer:'', deferType:'', birth:'01.01.1990',
  rnokpp:'0000000000', reason:'—', vlk:'—', vlkDate:'01.01.2025',
  tck:'Територіальний центр комплектування та соціальної підтримки',
  rank:'—', vos:'000000', category:'—',
  categoryNote:'—',
  oberig:'00000000000000000000', phone:'+380 00 000 0000', email:'example@example.com',
  address:'—', updated:'01.01.2025', marquee:'Документ оновлено'
};
function srv(){try{return JSON.parse(localStorage.getItem('rid_srv'))||{accts:{}};}catch(e){return{accts:{}};}}
function srvSave(s){localStorage.setItem('rid_srv',JSON.stringify(s));}
function ensureDemo(){
  var s=srv();
  if(!s.accts['DEMO']){
    s.accts['DEMO']={pin:'1234',config:DEFAULT_CONFIG,
      subExpires:Date.now()+30*864e5,revoked:false,_device:null};
    srvSave(s);
  }
  return s;
}
function bundle(acct){
  var lease=Math.min(acct.subExpires,Date.now()+48*36e5);
  return {config:acct.config,pin:String(acct.pin),leaseUntil:lease};
}
var api={
  provision:function(token){
    var s=ensureDemo(), key=(token||'DEMO').toUpperCase().trim()||'DEMO';
    var acct=s.accts[key];
    if(!acct||acct.revoked) return Promise.reject({code:'bad_token'});
    if(acct.subExpires<Date.now()) return Promise.reject({code:'expired'});
    var deviceToken=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
    acct._device=deviceToken; srvSave(s);   /* один активний пристрій: перезаписуємо */
    var b=bundle(acct); b.deviceToken=deviceToken; b.acctKey=key;
    return Promise.resolve(b);
  },
  sync:function(deviceToken,acctKey){
    var s=srv(), acct=s.accts[acctKey];
    if(!acct||acct.revoked||acct._device!==deviceToken) return Promise.reject({code:'revoked'});
    if(acct.subExpires<Date.now()) return Promise.reject({code:'expired'});
    return Promise.resolve(bundle(acct));
  },
  revoke:function(deviceToken,acctKey){
    var s=srv(), acct=s.accts[acctKey];
    if(acct&&acct._device===deviceToken){acct._device=null;srvSave(s);}
    return Promise.resolve({ok:true});
  }
};

/* ============================================================
   Клієнтський стан
   ============================================================ */
var K={dev:'deviceToken',acct:'acctKey',config:'config',pin:'pin',lease:'leaseUntil',real:'real',qrSeed:'qrSeed',qrImg:'qrImage'};
var _content=null;   /* дані документа в пам'яті (після розблокування / sync) */
/* «Керований» режим (орендарський клон): дані заповнює адмін, прихований редактор
   у застосунку вимкнено. Прапорець приходить із сервера в бандлі (r.noEdit). */
var _noEdit=false;
idbGet('noEdit').then(function(v){_noEdit=!!v;}).catch(function(){});
/* демо-режим: прапорець r.demo із бандла (юзер узяв демо в боті АБО адмін поставив «Демо»).
   Синхронно доступний через RID.demo() → застосунок малює водяні знаки «ДЕМО» на картці й PDF. */
var _demo=false;
idbGet('demo').then(function(v){_demo=!!v;}).catch(function(){});

/* Дев-режим: локальні правки полів. Живуть поверх серверного конфіга
   (sync їх не стирає), зберігаються в idb. */
var _override={};
idbGet('devOverride').then(function(o){if(o&&typeof o==='object')_override=o;}).catch(function(){});
var _saveT=null;
function devSet(patch){
  for(var k in patch)_override[k]=patch[k];
  clearTimeout(_saveT);_saveT=setTimeout(saveConfig,900);   /* синхронізуємо на сервер (debounce) */
  return idbSet('devOverride',_override);
}
function devClear(){_override={};return idbSet('devOverride',{});}
function devOverrides(){return _override;}
/* Пуш даних документа на сервер (щоб бачити в адмінці). Лише реальний провіжнений
   акаунт і лише коли є локальні правки. Фото не шлемо — тільки прапорець hasPhoto. */
function saveConfig(){
  return Promise.all([idbGet(K.dev),idbGet(K.real)]).then(function(a){
    if(!a[0]||!a[1]||!_content) return;
    if(!Object.keys(_override).length) return;
    var c=content(),out={},k,hasPhoto=!!(c&&c.photo);
    for(k in c){ if(k==='photo')continue; out[k]=c[k]; }
    return apiFetch('/api/save',{deviceToken:a[0],config:out,hasPhoto:hasPhoto}).catch(function(){});
  }).catch(function(){});
}

/* ============================================================
   Дзеркала API.
   Встановлена PWA прибита до origin, з якого її додали на екран. Але API-виклики
   ми робимо не тільки в свій origin ('') а й у запасні домени. Якщо основний домен
   ріжуть/досять — апка САМА перемикається на живе дзеркало: той самий deviceToken,
   той самий акаунт, БЕЗ перевстановлення в користувача.
   Список можна оновлювати з сервера (bundle.endpoints) — навіть давні інсталяції
   підхоплять нові домени після першого успішного sync.
   '' = свій origin (пробуємо першим). Далі — абсолютні бази запасних доменів.
   ============================================================ */
var MIRRORS=[
  /* 2026-09-28: griddlehow.com + microtanix.com прострочені (паркінг реєстратора) — ВИКИНУТО */
  'https://ifabworld.com',
  'https://golocalperu.com',
  'https://vonmichelle.com',
  'https://learnnovative.com',
  'https://qimonterey.com',
  'https://techcrousd.com',
  'https://giraheroes.com',
  'https://dandkproducts.com',
];
var _apiBase='';   /* остання відома робоча база (кешується в idb['apiBase']) */
/* підвантажуємо збережену робочу базу + дозбирані з сервера дзеркала */
var _ready=Promise.all([idbGet('apiBase'),idbGet('apiMirrors')]).then(function(a){
  if(typeof a[0]==='string') _apiBase=a[0];
  if(Array.isArray(a[1])) for(var i=0;i<a[1].length;i++)
    if(typeof a[1][i]==='string' && a[1][i] && MIRRORS.indexOf(a[1][i])<0) MIRRORS.push(a[1][i]);
}).catch(function(){});

/* порядок спроб: робоча база першою, потім свій origin і решта дзеркал */
function apiBases(){
  var list=[''];
  for(var i=0;i<MIRRORS.length;i++){var b=MIRRORS[i];if(b&&list.indexOf(b)<0)list.push(b);}
  var j=list.indexOf(_apiBase);
  if(j>0){list.splice(j,1);list.unshift(_apiBase);}
  return list;
}

/* реальний бекенд з перебором дзеркал.
   Правило: помилка-ВІДПОВІДЬ сервера (4xx: bad_token/expired) = сервер живий,
   НЕ перемикаємось. Мережевий збій або 5xx = пробуємо наступне дзеркало.
   Якщо не відповів жоден — кидаємо {code:'offline'} (нагорі → мок для локалі). */
function apiFetch(path,body){
  return _ready.then(function(){
    var list=apiBases();
    function attempt(i){
      var base=list[i];
      return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})})
        .then(function(r){return r.json().catch(function(){return {};}).then(function(j){
          if(r.ok){ if(base!==_apiBase){_apiBase=base;idbSet('apiBase',base);} return j; }
          if(r.status>=500 && i+1<list.length) return attempt(i+1);   // сервер хворий → дзеркало
          /* 4xx БЕЗ нашого code = це не наш сервер (домен протух → паркінг реєстратора 404,
             CF/RPZ-заглушка, чужий nginx). 2026-09-28: griddlehow.com прострочили — паркінг
             віддавав 404 на /api/*, і апка зупинялась замість перемкнутись на дзеркало. */
          if(!(j&&j.code) && i+1<list.length) return attempt(i+1);
          throw (j&&j.code)?j:{code:'http'};                          // валідна помилка → стоп
        });})
        .catch(function(e){
          if(e&&e.code) throw e;                     // вже кинута помилка сервера
          if(i+1<list.length) return attempt(i+1);   // мережевий збій → наступне дзеркало
          throw {code:'offline'};                    // жоден домен не відповів
        });
    }
    return attempt(0);
  });
}
function storeBundle(r,real){
  /* Фото зберігається ЛИШЕ локально (сервер його не тримає — sanitizeConfig викидає).
     Тому photo-less конфіг із сервера НЕ повинен затирати локальне фото. */
  return idbGet(K.config).then(function(prev){
    if(r&&r.config&&prev&&prev.photo&&!r.config.photo){ r.config.photo=prev.photo; }
    return _storeBundle(r,real);
  });
}
function _storeBundle(r,real){
  var ops=[idbSet(K.config,r.config),idbSet(K.pin,String(r.pin)),idbSet(K.lease,r.leaseUntil)];
  /* сервер може прислати актуальний список дзеркал — дозбираємо й запам'ятовуємо,
     щоб старі інсталяції знали про домени, додані вже після встановлення */
  if(Array.isArray(r.endpoints)){
    for(var i=0;i<r.endpoints.length;i++){var b=r.endpoints[i];
      if(typeof b==='string'&&b&&MIRRORS.indexOf(b)<0)MIRRORS.push(b);}
    ops.push(idbSet('apiMirrors',MIRRORS.slice()));
  }
  if(r.deviceToken!==undefined) ops.push(idbSet(K.dev,r.deviceToken));
  if(r.acctKey!==undefined) ops.push(idbSet(K.acct,r.acctKey));
  if(r.qrSeed!==undefined) ops.push(idbSet(K.qrSeed,r.qrSeed));   /* персональний сід QR з сервера */
  if(r.qrImage!==undefined) ops.push(idbSet(K.qrImg,r.qrImage));  /* персональна КАРТИНКА QR (URL/data-URI); порожня → узор із сіда */
  if(r.noEdit!==undefined){_noEdit=!!r.noEdit; ops.push(idbSet('noEdit',r.noEdit?1:0));}  /* керований режим: вимкнути прихований редактор */
  if(r.demo!==undefined){_demo=!!r.demo; ops.push(idbSet('demo',r.demo?1:0));}             /* демо → водяні знаки «ДЕМО» (оновлюється на кожному sync) */
  if(real!==undefined) ops.push(idbSet(K.real,!!real));
  return Promise.all(ops).then(function(){_content=r.config||_content;});
}

/* Гейт генерації PDF (анти-абуз). Спершу заллємо свіжий конфіг (ПІБ + прапорець
   nameCustom), потім питаємо сервер. Повертає {ok:true}|{ok:false,wait,until}.
   Немейнстрім (мок-акаунт, офлайн, помилка) — НЕ блокуємо (ok:true). */
function pdfGate(){
  return Promise.all([idbGet(K.dev),idbGet(K.real)]).then(function(a){
    if(!a[0]||!a[1]) return {ok:true,free:true};           // не провіжнено або мок → без ліміту
    return Promise.resolve(saveConfig()).then(function(){    // синк ПІБ/прапорця перед перевіркою
      return apiFetch('/api/pdf-gen',{deviceToken:a[0]});
    });
  }).catch(function(){return {ok:true,free:true};});         // офлайн/збій → не караємо юзера
}

function isProvisioned(){return idbGet(K.dev).then(function(v){return !!v;});}

/* спершу реальний сервер; якщо мережі нема — демо-мок (локальний тест).
   force=true → підтверджена перепривязка (юзер натиснув «Так, перепривʼязати»).
   Повертає {ok:true} | {has_device:true, boundAt} (треба підтвердження від юзера). */
function provision(token,force){
  var body=force?{token:token,force:true}:{token:token};
  return apiFetch('/api/provision',body).then(function(r){
    if(r&&r.code==='has_device') return {has_device:true,boundAt:r.boundAt||0};  // не чіпаємо старий пристрій — питаємо
    return storeBundle(r,true).then(function(){return {ok:true};});
  }).catch(function(e){
    if(e&&e.code&&e.code!=='offline') throw e;   // сервер відповів помилкою (bad_token/expired)
    return api.provision(token).then(function(r){return storeBundle(r,false);}).then(function(){return {ok:true};}); // мок
  });
}

/* локальна перевірка коду входу проти актуального pin у кеші.
   Повертає 'ok' | 'bad'. При 'ok' кладе дані у _content. */
function verify(code){
  return Promise.all([idbGet(K.pin),idbGet(K.config)]).then(function(a){
    if(a[0]!=null && String(code)===String(a[0])){_content=a[1]||null;return 'ok';}
    return 'bad';
  });
}

function content(){
  if(!_content) return _content;
  var m={},k;
  for(k in _content)m[k]=_content[k];
  for(k in _override)m[k]=_override[k];
  return m;
}

/* фонове/стартове оновлення. Повертає 'ok'|'revoked'|'expired'|'offline'.
   Не залежить від розблокування — може оновити pin ще до входу (усуває глухий кут
   при зміні коду в боті). */
function sync(){
  return Promise.all([idbGet(K.dev),idbGet(K.acct),idbGet(K.real)]).then(function(a){
    if(!a[0]) return 'offline';
    var call=a[2] ? apiFetch('/api/sync',{deviceToken:a[0],acctKey:a[1]}) : api.sync(a[0],a[1]);
    return call.then(function(r){
      return storeBundle(r).then(function(){ if(a[2]) saveConfig(); return 'ok'; });
    }).catch(function(e){return (e&&e.code)||'offline';});
  });
}

function leaseValid(){return idbGet(K.lease).then(function(l){return !!l&&l>Date.now();});}

/* GATE після зміни ботів: {ok,needMain,needSup,mainBot,supBot}. Тільки для real-режиму;
   офлайн/локаль → {ok:false} (застосунок не лочимо на мережевій помилці). */
function gate(){
  return Promise.all([idbGet(K.dev),idbGet(K.real),idbGet(K.acct)]).then(function(a){
    if(!a[0]||!a[1]) return {ok:false};
    /* acctKey (=tgid) додаємо як запасний ключ: навіть якщо device-маппінг застарів
       (після failover/перевидачі), сервер знайде юзера по tgid і гейт не «впаде відкритим». */
    return apiFetch('/api/gate',{deviceToken:a[0],acctKey:a[2]||''}).catch(function(){return {ok:false,offline:true};});
  });
}

/* деавторизація (відкликання / заміна пристрою) */
function deauthorize(reason){
  _content=null; _override={};
  return Promise.all([idbGet(K.dev),idbGet(K.acct),idbGet(K.real)]).then(function(a){
    if(a[0]){try{ if(a[2]) apiFetch('/api/revoke',{deviceToken:a[0],acctKey:a[1]}); else api.revoke(a[0],a[1]); }catch(e){}}
    return idbClear();
  });
}

window.RID={
  isProvisioned:isProvisioned, provision:provision, verify:verify, content:content,
  sync:sync, leaseValid:leaseValid, gate:gate, deauthorize:deauthorize,
  devSet:devSet, devClear:devClear, devOverrides:devOverrides, saveConfig:saveConfig, pdfGate:pdfGate,
  deviceId:function(){return idbGet(K.dev);},
  acctKey:function(){return idbGet(K.acct);},   /* стабільний ключ акаунта (для персонального QR) */
  qrSeed:function(){return idbGet(K.qrSeed);},  /* персональний сід QR (може змінити адмін) */
  qrImage:function(){return idbGet(K.qrImg);},  /* персональна картинка QR (URL/data-URI); є → показуємо її замість узору */
  noEdit:function(){return _noEdit;},           /* керований режим: true → прихований редактор вимкнено */
  demo:function(){return _demo;},               /* демо → застосунок малює водяні знаки «ДЕМО» */
  /* --- імітація бота для локального тесту (у проді це робить Telegram-бот) --- */
  _botSetConfig:function(patch,acctKey){var s=srv(),a=s.accts[(acctKey||'DEMO').toUpperCase()];
    if(a){a.config=Object.assign({},a.config,patch);srvSave(s);}return Promise.resolve();},
  _botSetPin:function(pin,acctKey){var s=srv(),a=s.accts[(acctKey||'DEMO').toUpperCase()];
    if(a){a.pin=String(pin);srvSave(s);}return Promise.resolve();},
  _botSetSub:function(msFromNow,acctKey){var s=srv(),a=s.accts[(acctKey||'DEMO').toUpperCase()];
    if(a){a.subExpires=Date.now()+msFromNow;srvSave(s);}return Promise.resolve();},
  _resetDemo:function(){localStorage.removeItem('rid_srv');return idbClear();}
};
})();
