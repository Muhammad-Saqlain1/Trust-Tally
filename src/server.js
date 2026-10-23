import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './db.js';
import { authRoutes } from './auth.js';
import { apiRoutes } from './api.js';
import { ensure } from './lib/errors.js';

export function createApp(db, options = {}) {
  const app=express(), production=process.env.NODE_ENV === 'production';
  const secure=production || process.env.COOKIE_SECURE === 'true';
  app.disable('x-powered-by');
  if(process.env.TRUST_PROXY === 'true')app.set('trust proxy',1);
  app.use((req,res,next)=>{
    res.set({ 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'no-referrer', 'Permissions-Policy':'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    if(secure)res.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
    next();
  });
  app.use('/api',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      ensure(req.get('X-Requested-With') === 'TrustTally',403,'Invalid request source.');
      ensure(req.is('application/json'),415,'Send application/json.');
      const origin=req.get('Origin');
      if(origin)ensure(origin === `${req.protocol}://${req.get('host')}`,403,'Cross-origin requests are not allowed.');
    }next();
  });
  app.use(express.json({limit:'128kb'}));
  app.use('/api',(req,res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method))ensure(req.body && typeof req.body==='object' && !Array.isArray(req.body),400,'Send a JSON object.');
    next();
  });
  const attempts=new Map();
  const cleanup=setInterval(()=>{const now=Date.now();for(const [key,bucket] of attempts)if(bucket.until<now)attempts.delete(key);},60000);
  cleanup.unref();
  app.use('/api/auth',(req,res,next)=>{
    if(req.method === 'GET')return next();
    const now=Date.now(),key=req.ip,bucket=attempts.get(key);
    const current=bucket && bucket.until>now ? bucket : {n:0,until:now+15*60*1000};
    current.n++;attempts.set(key,current);
    res.set('RateLimit-Limit','30');
    if(current.n>30){res.set('Retry-After',String(Math.ceil((current.until-now)/1000)));return res.status(429).json({error:'Too many sign-in attempts. Try again in 15 minutes.'});}
    next();
  });
  app.get('/api/health',async(req,res)=>{
    let database='unavailable';try{await db.query('SELECT 1');database='connected';}catch{/* Do not expose connection credentials. */}
    res.json({status:'running',database,release:'core'});
  });
  app.get('/api/auth/invite',async(req,res)=>{
    const { digest }=await import('./lib/security.js');
    ensure(typeof req.query.token === 'string' && /^[a-f0-9]{64}$/.test(req.query.token),400,'Invalid invitation.');
    const rows=await db.query("SELECT c.name,c.phone,s.shop_name,s.owner_name FROM customers c JOIN shops s ON s.shop_id=c.shop_id WHERE c.invite_hash=? AND c.consent_status='invited' AND c.status='active' AND c.invite_expires_at>UTC_TIMESTAMP(3)",[digest(req.query.token)]);
    ensure(rows[0],404,'Invitation expired or unavailable.');
    res.json({name:rows[0].name,phoneHint:'••••'+rows[0].phone.slice(-4),shopName:rows[0].shop_name,ownerName:rows[0].owner_name});
  });
  app.use('/api/auth',authRoutes(db,{...options,secure}));
  app.use('/api',apiRoutes(db));
  app.use('/api',(req,res)=>res.status(404).json({error:'This API route is unavailable.'}));
  const root=fileURLToPath(new URL('../public/',import.meta.url));
  app.use(express.static(root,{dotfiles:'deny',etag:true,setHeaders(res,file){if(file.endsWith('sw.js'))res.set('Cache-Control','no-cache');}}));
  app.get('/',(req,res)=>res.sendFile(path.join(root,'index.html')));
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    let status=error.status || 500,message=error.message;
    if(error.type === 'entity.parse.failed'){status=400;message='The request contains invalid JSON.';}
    if(error.code === 'ER_DUP_ENTRY'){status=409;message='An account, customer, or request with these details already exists.';}
    if(['ECONNREFUSED','ENOTFOUND','ER_ACCESS_DENIED_ERROR','ER_BAD_DB_ERROR'].includes(error.code)){status=503;message='The database is unavailable. Check the MySQL connection and migration.';}
    if(error.code === 'ER_SIGNAL_EXCEPTION'){status=409;message=error.sqlMessage;}
    if(status>=500 && status !== 503){console.error('Request failed:',error.code || error.name);message='The request could not be completed. No partial financial entry was saved.';}
    res.status(status).json({error:message});
  });
  app.locals.cleanup=()=>clearInterval(cleanup);
  return app;
}
if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db=createDatabase(),app=createApp(db),host=process.env.HOST || '127.0.0.1',port=Number(process.env.PORT || 3000);
  const server=app.listen(port,host,()=>console.log(`Trust-Tally: http://${host}:${port}\nCore release · MySQL · HTML/CSS/JavaScript · installable PWA`));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{app.locals.cleanup();server.close(async()=>{await db.close();process.exit(0);});});
}
