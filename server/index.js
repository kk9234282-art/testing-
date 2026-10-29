import express from 'express';
import { listings, parseChart } from './market.js';
const app=express();
const cache=new Map();
app.get('/api/health',(_,res)=>res.json({ok:true}));
app.get('/api/quote/:symbol',async(req,res)=>{
 const symbol=req.params.symbol;
 if(!listings.some(s=>s.symbol===symbol)) return res.status(400).json({error:'Unsupported symbol'});
 const cached=cache.get(symbol);
 if(cached && Date.now()-cached.fetched<60000) return res.json(cached.data);
 try {
 const response=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=1d&range=1mo`,{signal:AbortSignal.timeout(10000),headers:{'User-Agent':'Mozilla/5.0'}});
 if(!response.ok) throw new Error(`Provider HTTP ${response.status}`);
 const quote=parseChart(symbol,await response.json());
 const data={...quote,source:'Yahoo Finance (unofficial)',fetchedAt:new Date().toISOString()};
 cache.set(symbol,{fetched:Date.now(),data});res.json(data);
 } catch {res.status(502).json({error:'Free market data is unavailable. Try again later or switch to sample data.'});}
});
app.use(express.static('dist'));
app.listen(Number(process.env.PORT)||3001,'0.0.0.0',()=>console.log('Tickr API listening on port '+(process.env.PORT||3001)));
