const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_STORE = path.join(ROOT, 'data', 'default-store.json');
let DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (error) { console.warn(`Cannot use DATA_DIR ${DATA_DIR}; falling back to local data folder: ${error.message}`); DATA_DIR = path.join(ROOT, 'data'); fs.mkdirSync(DATA_DIR, { recursive: true }); }
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const JWT_SECRET = String(process.env.JWT_SECRET || 'local-development-secret-change-on-render');

if (!fs.existsSync(STORE_FILE)) fs.copyFileSync(DEFAULT_STORE, STORE_FILE);

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
  catch (error) {
    console.error('Store read failed, restoring defaults:', error.message);
    const fallback = JSON.parse(fs.readFileSync(DEFAULT_STORE, 'utf8'));
    writeStore(fallback);
    return fallback;
  }
}
function writeStore(store) {
  const temp = STORE_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(store, null, 2));
  fs.renameSync(temp, STORE_FILE);
}
function newId(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`; }
function base64url(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function signature(payload) { return crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url'); }
function issueToken(user) {
  const payload = base64url({ id:user.id, email:user.email, name:user.name, role:user.role, exp:Date.now() + 180*864e5 });
  return `${payload}.${signature(payload)}`;
}
function verifyToken(raw) {
  try {
    if (!raw || !raw.includes('.')) return null;
    const [payload, supplied] = raw.split('.');
    const expected = signature(payload);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded.exp > Date.now() ? decoded : null;
  } catch { return null; }
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
    return candidate.length === hash.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
  } catch { return false; }
}
function safeUser(user) { const { passwordHash, ...safe } = user; return safe; }
function ensureAdmin() {
  const store = readStore();
  const email = String(process.env.ADMIN_EMAIL || 'admin@rsrshop.com').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || 'ChangeMe123!');
  let admin = store.users.find(u => u.role === 'admin');
  if (!admin) {
    admin = { id:newId('usr'), name:'RSR Administrator', email, passwordHash:hashPassword(password), role:'admin', createdAt:new Date().toISOString() };
    store.users.push(admin);
  } else {
    admin.email = email;
    if (process.env.ADMIN_PASSWORD && admin.passwordSyncedTo !== password) {
      admin.passwordHash = hashPassword(password);
      admin.passwordSyncedTo = password;
    }
  }
  writeStore(store);
}
ensureAdmin();

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  res.end(JSON.stringify(payload));
}
function sendDataImage(res, value) {
  const match=String(value||'').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if(!match){ res.writeHead(404,{'content-type':'text/plain','cache-control':'no-store'}); return res.end('Image unavailable'); }
  const subtype=match[1].toLowerCase(); const type=subtype==='jpeg'?'image/jpeg':`image/${subtype}`;
  const buffer=Buffer.from(match[2],'base64');
  res.writeHead(200,{'content-type':type,'content-length':buffer.length,'cache-control':'private, max-age=60','x-content-type-options':'nosniff'});
  res.end(buffer);
}
function parseBody(req, limit = 10_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > limit) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function currentUser(req, url) { const header=String(req.headers.authorization||'').replace(/^Bearer\s+/i,''); const query=url?.searchParams?.get('token')||''; return verifyToken(header||query); }
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...options, signal:controller.signal, headers:{ 'user-agent':'RSR-Shop-V20', 'content-type':'application/json', ...(options.headers||{}) } });
    const text = await response.text();
    let data = {}; try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) throw new Error(data.errors?.[0]?.message || data.message || `Request failed (${response.status})`);
    return data;
  } finally { clearTimeout(timeout); }
}
function extractDigits(value) { const matches = String(value || '').match(/\d+/g); return matches ? matches[matches.length - 1] : ''; }

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok:true, version:'22.2.0', dataDir:DATA_DIR });
  if (req.method === 'GET' && url.pathname === '/api/config') {
    const store = readStore(); const s = store.settings;
    return sendJson(res, 200, { ...s, shopName:process.env.SHOP_NAME || s.shopName, contactEmail:process.env.CONTACT_EMAIL || '', contactPhone:process.env.CONTACT_PHONE || '', businessLocation:process.env.BUSINESS_LOCATION || 'Philippines', facebookUrl:process.env.FACEBOOK_URL || '' });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    const body = await parseBody(req); const name=String(body.name||'').trim(), email=String(body.email||'').trim().toLowerCase(), password=String(body.password||'');
    if (name.length < 2) return sendJson(res,400,{error:'Enter your full name.'});
    if (!/^\S+@\S+\.\S+$/.test(email)) return sendJson(res,400,{error:'Enter a valid email address.'});
    if (password.length < 8) return sendJson(res,400,{error:'Password must contain at least 8 characters.'});
    const store=readStore(); if (store.users.some(u=>u.email===email)) return sendJson(res,409,{error:'This email already has an account. Choose Sign In.'});
    const user={id:newId('usr'),name,email,passwordHash:hashPassword(password),role:'customer',createdAt:new Date().toISOString()}; store.users.push(user); writeStore(store);
    return sendJson(res,201,{token:issueToken(user),user:safeUser(user)});
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body=await parseBody(req); const email=String(body.email||'').trim().toLowerCase(), password=String(body.password||'');
    const store=readStore(); const user=store.users.find(u=>u.email===email);
    if (!user || !verifyPassword(password,user.passwordHash)) return sendJson(res,401,{error:'Incorrect email or password.'});
    return sendJson(res,200,{token:issueToken(user),user:safeUser(user)});
  }
  if (req.method === 'POST' && url.pathname === '/api/roblox/user') {
    const body=await parseBody(req); const input=String(body.input||'').trim(); if(!input)return sendJson(res,400,{error:'Enter a Roblox username or profile link.'});
    try {
      let user;
      if (/roblox\.com\/users\//i.test(input) || /^\d+$/.test(input)) {
        const userId=extractDigits(input); user=await fetchJson(`https://users.roblox.com/v1/users/${userId}`);
      } else {
        const result=await fetchJson('https://users.roblox.com/v1/usernames/users',{method:'POST',body:JSON.stringify({usernames:[input],excludeBannedUsers:true})}); user=result.data?.[0];
      }
      if(!user)return sendJson(res,404,{error:'Roblox account not found.'});
      let avatar=''; try { const thumbs=await fetchJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`); avatar=thumbs.data?.[0]?.imageUrl||''; } catch {}
      return sendJson(res,200,{user:{id:user.id,name:user.name,displayName:user.displayName,description:user.description||'',avatar,profileUrl:`https://www.roblox.com/users/${user.id}/profile`}});
    } catch(error){ return sendJson(res,502,{error:`Roblox verification unavailable: ${error.message}`}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/roblox/gamepass') {
    const body=await parseBody(req); const id=extractDigits(body.input); if(!id)return sendJson(res,400,{error:'Enter a valid gamepass link or ID.'});
    try { const item=await fetchJson(`https://economy.roblox.com/v2/assets/${id}/details`); return sendJson(res,200,{gamepass:{id:Number(id),name:item.Name||item.name||`Gamepass ${id}`,price:Number(item.PriceInRobux||item.price||0),creator:item.Creator?.Name||item.creator?.name||'Unknown',productId:item.ProductId||null,url:`https://www.roblox.com/game-pass/${id}`}}); }
    catch(error){ return sendJson(res,502,{error:`Gamepass verification unavailable: ${error.message}`}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/roblox/game') {
    const body=await parseBody(req); const placeId=extractDigits(body.input); if(!placeId)return sendJson(res,400,{error:'Enter a valid Roblox game link or Place ID.'});
    try {
      // Roblox's old multiget-place-details route now requires authenticated cookies.
      // Resolve the public Place ID to a Universe ID first, then request public game details.
      const universeResult=await fetchJson(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
      const universeId=Number(universeResult.universeId||universeResult.UniverseId||0);
      if(!universeId)throw new Error('Could not find the experience connected to this Place ID');
      const result=await fetchJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
      const game=result.data?.[0]; if(!game)throw new Error('Game not found or not publicly available');
      let icon='';
      try { const thumbs=await fetchJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`); icon=thumbs.data?.[0]?.imageUrl||''; } catch {}
      return sendJson(res,200,{game:{placeId:Number(placeId),name:game.name||`Place ${placeId}`,creatorName:game.creator?.name||'Unknown',creatorId:game.creator?.id||null,universeId,icon,url:`https://www.roblox.com/games/${placeId}`}});
    }
    catch(error){ return sendJson(res,502,{error:`Roblox game verification is temporarily unavailable: ${error.message}`}); }
  }

  const auth=currentUser(req,url);
  if (url.pathname.startsWith('/api/') && !auth) return sendJson(res,401,{error:'Your session expired. Please sign in again.'});
  const store=readStore(); const dbUser=store.users.find(u=>u.id===auth.id);
  if (!dbUser) return sendJson(res,401,{error:'Account not found. Please sign in again.'});

  if (req.method==='GET' && url.pathname==='/api/me') return sendJson(res,200,{user:safeUser(dbUser)});
  if (req.method==='GET' && url.pathname==='/api/orders') {
    const source=(dbUser.role==='admin'?store.orders:store.orders.filter(o=>o.userId===dbUser.id)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const orders=source.map(({receiptData,deliveryProof,...o})=>({...o,hasReceipt:Boolean(receiptData),hasDeliveryProof:Boolean(deliveryProof)}));
    return sendJson(res,200,{orders});
  }
  if (req.method==='GET' && /^\/api\/orders\/[^/]+\/(receipt|proof)$/.test(url.pathname)) {
    const parts=url.pathname.split('/'); const orderId=parts[3], kind=parts[4]; const order=store.orders.find(o=>o.id===orderId);
    if(!order)return sendJson(res,404,{error:'Order not found.'});
    if(dbUser.role!=='admin'&&order.userId!==dbUser.id)return sendJson(res,403,{error:'You cannot view this image.'});
    return sendDataImage(res,kind==='receipt'?order.receiptData:order.deliveryProof);
  }
  if (req.method==='GET' && /^\/api\/orders\/[^/]+$/.test(url.pathname)) {
    const orderId=url.pathname.split('/').pop();const order=store.orders.find(o=>o.id===orderId);
    if(!order)return sendJson(res,404,{error:'Order not found.'});
    if(dbUser.role!=='admin'&&order.userId!==dbUser.id)return sendJson(res,403,{error:'You cannot view this order.'});
    return sendJson(res,200,{order:{...order,hasReceipt:Boolean(order.receiptData),hasDeliveryProof:Boolean(order.deliveryProof)}});
  }
  if (req.method==='POST' && url.pathname==='/api/orders') {
    const body=await parseBody(req); const amount=Math.floor(Number(body.robuxAmount)); const method=String(body.method||''); const settings=store.settings;
    if(!settings.methods[method])return sendJson(res,400,{error:'This order method is currently unavailable.'});
    if(!body.robloxUser?.id || !body.robloxUser?.name)return sendJson(res,400,{error:'Verify the Roblox account first.'});
    if(!Number.isFinite(amount)||amount<settings.minRobux||amount>settings.maxRobux)return sendJson(res,400,{error:`Robux amount must be from ${settings.minRobux.toLocaleString()} to ${settings.maxRobux.toLocaleString()}.`});
    if(!body.paymentMethod||!String(body.receiptData||'').startsWith('data:image/'))return sendJson(res,400,{error:'Choose a payment method and upload a receipt image.'});
    const requiredGamepass = method==='covered_tax' ? Math.ceil(amount/0.7) : (method==='not_covered_tax'?amount:0);
    if((method==='covered_tax'||method==='not_covered_tax')){
      const passes=Array.isArray(body.gamepasses)?body.gamepasses:[]; const total=passes.reduce((s,p)=>s+Number(p.price||0),0);
      if(!passes.length)return sendJson(res,400,{error:'Verify at least one gamepass.'});
      if(total!==requiredGamepass)return sendJson(res,400,{error:`Verified gamepasses total R$ ${total.toLocaleString()}, but required total is R$ ${requiredGamepass.toLocaleString()}.`});
    }
    if(method==='gifting'){if(!body.game?.placeId)return sendJson(res,400,{error:'Verify the Roblox game first.'});const g=body.giftingDetails||{};if(String(g.recipientUsername||'').trim().length<3)return sendJson(res,400,{error:'Enter the recipient Roblox username.'});if(String(g.itemName||'').trim().length<2)return sendJson(res,400,{error:'Enter the item or gift name.'});}
    const rate=Number(settings.rates[method]||0); const totalPhp=Math.round(amount*rate*100)/100;
    const order={id:newId('ord'),orderNo:`RSR-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(store.orders.length+1).padStart(5,'0')}`,userId:dbUser.id,customerName:dbUser.name,customerEmail:dbUser.email,method,robloxUser:body.robloxUser,robuxAmount:amount,requiredGamepass,gamepasses:body.gamepasses||[],game:body.game||null,giftingDetails:body.giftingDetails?{recipientUsername:String(body.giftingDetails.recipientUsername||'').trim().slice(0,50),itemName:String(body.giftingDetails.itemName||'').trim().slice(0,120),quantity:Math.max(1,Math.min(999,Math.floor(Number(body.giftingDetails.quantity||1)))),instructions:String(body.giftingDetails.instructions||'').trim().slice(0,500)}:null,totalPhp,paymentMethod:String(body.paymentMethod),receiptData:String(body.receiptData),receiptVerified:false,status:'Pending Review',adminNote:'',deliveryProof:'',timeline:[{status:'Pending Review',at:new Date().toISOString(),by:dbUser.name}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    store.orders.push(order); writeStore(store); return sendJson(res,201,{order});
  }
  if (req.method==='PATCH' && url.pathname.startsWith('/api/admin/orders/')) {
    if(dbUser.role!=='admin')return sendJson(res,403,{error:'Admin access required.'});
    const orderId=url.pathname.split('/').pop(); const body=await parseBody(req); const order=store.orders.find(o=>o.id===orderId); if(!order)return sendJson(res,404,{error:'Order not found.'});
    const action=String(body.action||'');
    if(['Completed','Cancelled'].includes(order.status)) return sendJson(res,400,{error:'This order is already closed.'});
    if(action==='complete'){
      order.status='Completed';
      order.receiptVerified=true;
      order.adminNote=String(body.adminNote||order.adminNote||'Order completed successfully.').trim();
      const proof=String(body.deliveryProof||'');
      if(proof && !proof.startsWith('data:image/')) return sendJson(res,400,{error:'Delivery proof must be an image.'});
      if(proof.length>7_000_000) return sendJson(res,400,{error:'Delivery proof image is too large.'});
      order.deliveryProof=proof||order.deliveryProof||'';
    }
    else if(action==='cancel'){
      const reason=String(body.adminNote||'').trim();
      if(reason.length<5)return sendJson(res,400,{error:'Enter a clear cancellation reason.'});
      order.status='Cancelled';
      order.adminNote=reason;
    }
    else return sendJson(res,400,{error:'Only Complete or Cancel actions are available.'});
    order.updatedAt=new Date().toISOString();order.timeline=order.timeline||[];order.timeline.push({status:order.status,at:order.updatedAt,by:dbUser.name,note:order.adminNote||''});writeStore(store);return sendJson(res,200,{order});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/settings'){
    if(dbUser.role!=='admin')return sendJson(res,403,{error:'Admin access required.'});
    return sendJson(res,200,{settings:store.settings});
  }
  if(req.method==='PATCH'&&url.pathname==='/api/admin/settings'){
    if(dbUser.role!=='admin')return sendJson(res,403,{error:'Admin access required.'});
    const body=await parseBody(req);const methodIds=['covered_tax','not_covered_tax','instant_send','gifting'];
    store.settings.rates=store.settings.rates||{};store.settings.methods=store.settings.methods||{};
    for(const id of methodIds){
      if(body.rates&&Object.prototype.hasOwnProperty.call(body.rates,id)){
        const rate=Number(body.rates[id]);if(!Number.isFinite(rate)||rate<0||rate>100)return sendJson(res,400,{error:`Invalid ${id} rate.`});store.settings.rates[id]=Math.round(rate*10000)/10000;
      }
      if(body.methods&&Object.prototype.hasOwnProperty.call(body.methods,id))store.settings.methods[id]=Boolean(body.methods[id]);
    }
    const min=Math.floor(Number(body.minRobux)),max=Math.floor(Number(body.maxRobux));
    if(!Number.isFinite(min)||!Number.isFinite(max)||min<1||max<min)return sendJson(res,400,{error:'Enter valid minimum and maximum Robux limits.'});
    store.settings.minRobux=min;store.settings.maxRobux=max;writeStore(store);return sendJson(res,200,{settings:store.settings});
  }
  if(req.method==='GET'&&url.pathname==='/api/chat'){
    const messages=dbUser.role==='admin'?store.messages:store.messages.filter(m=>m.userId===dbUser.id);return sendJson(res,200,{messages,customers:dbUser.role==='admin'?store.users.filter(u=>u.role==='customer').map(safeUser):undefined});
  }
  if(req.method==='POST'&&url.pathname==='/api/chat'){
    const body=await parseBody(req);const text=String(body.text||'').trim();if(!text)return sendJson(res,400,{error:'Type a message.'});const userId=dbUser.role==='admin'?String(body.userId||''):dbUser.id;if(!userId)return sendJson(res,400,{error:'Choose a customer conversation.'});const orderId=String(body.orderId||'');if(orderId){const order=store.orders.find(o=>o.id===orderId);if(!order||order.method!=='gifting')return sendJson(res,400,{error:'This gifting order chat is unavailable.'});if(dbUser.role!=='admin'&&order.userId!==dbUser.id)return sendJson(res,403,{error:'You cannot use this order chat.'});if(dbUser.role==='admin'&&order.userId!==userId)return sendJson(res,400,{error:'Select the customer who owns this gifting order.'});}const msg={id:newId('msg'),userId,orderId:orderId||'',senderId:dbUser.id,senderRole:dbUser.role,senderName:dbUser.name,text:text.slice(0,2000),createdAt:new Date().toISOString()};store.messages.push(msg);writeStore(store);return sendJson(res,201,{message:msg});
  }
  if(req.method==='GET'&&url.pathname==='/api/vouches')return sendJson(res,200,{vouches:store.vouches.filter(v=>v.approved)});
  if(req.method==='POST'&&url.pathname==='/api/vouches'){
    const body=await parseBody(req);const text=String(body.text||'').trim();const rating=Math.max(1,Math.min(5,Number(body.rating||5)));if(text.length<10)return sendJson(res,400,{error:'Please write at least 10 characters.'});const vouch={id:newId('vouch'),userId:dbUser.id,name:dbUser.name,robloxUsername:String(body.robloxUsername||''),rating,text,approved:false,createdAt:new Date().toISOString()};store.vouches.push(vouch);writeStore(store);return sendJson(res,201,{vouch,message:'Submitted for admin approval.'});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/vouches'){
    if(dbUser.role!=='admin')return sendJson(res,403,{error:'Admin access required.'});return sendJson(res,200,{vouches:store.vouches});
  }
  if(req.method==='PATCH'&&url.pathname.startsWith('/api/admin/vouches/')){
    if(dbUser.role!=='admin')return sendJson(res,403,{error:'Admin access required.'});const id=url.pathname.split('/').pop();const body=await parseBody(req);const v=store.vouches.find(x=>x.id===id);if(!v)return sendJson(res,404,{error:'Vouch not found.'});v.approved=Boolean(body.approved);writeStore(store);return sendJson(res,200,{vouch:v});
  }
  return sendJson(res,404,{error:'API route not found.'});
}

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/'))return await handleApi(req,res,url);
    let requested=url.pathname==='/'?'/index.html':url.pathname;
    const file=path.resolve(PUBLIC_DIR,'.'+requested);
    if(!file.startsWith(PUBLIC_DIR)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found');}
    const noCache=requested.endsWith('sw.js')||requested.endsWith('index.html');
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':noCache?'no-cache':'public, max-age=3600','x-content-type-options':'nosniff'});
    fs.createReadStream(file).pipe(res);
  }catch(error){console.error(error);sendJson(res,500,{error:'Unexpected server error.'});}
});
server.listen(PORT,()=>console.log(`RSR SHOP V20 running on http://localhost:${PORT}`));
