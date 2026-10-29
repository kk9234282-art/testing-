export const listings = [
 ['RELIANCE','Reliance Industries','Energy',2962.45,1.24,20.04,'R'],['TCS','Tata Consultancy Services','IT',4218.30,-0.68,15.26,'T'],['HDFCBANK','HDFC Bank','Banking',1685.20,0.92,12.84,'H'],['BHARTIARTL','Bharti Airtel','Telecom',1589.60,2.16,9.52,'A'],['ICICIBANK','ICICI Bank','Banking',1246.80,1.48,8.79,'I'],['INFY','Infosys','IT',1876.55,-1.12,7.79,'in'],['SBIN','State Bank of India','Banking',812.35,0.76,7.25,'S'],['ITC','ITC Limited','Consumer',506.70,0.34,6.34,'ITC'],['HINDUNILVR','Hindustan Unilever','Consumer',2890.10,-0.42,6.79,'U'],['LT','Larsen & Toubro','Industrials',3678.90,1.85,5.06,'L&T'],['SUNPHARMA','Sun Pharmaceutical','Healthcare',1845.25,0.58,4.43,'Sun'],['TATAMOTORS','Tata Motors','Auto',978.60,-0.89,3.60,'T']
].map(([symbol,name,sector,price,change,cap,logo],i)=>({symbol,name,sector,price,change,cap,logo,volume:((i*7+13)%48+8)/10}));
export function parseChart(symbol, data){
 const result=data?.chart?.result?.[0];
 const meta=result?.meta;
 if(!meta || !Number.isFinite(meta.regularMarketPrice)) throw new Error('Provider returned no price');
 const closes=result.indicators?.quote?.[0]?.close ?? [];
 const validCloses=closes.filter(Number.isFinite);
 const previous=meta.previousClose ?? validCloses.at(-2);
 return {symbol,price:meta.regularMarketPrice,change:previous ? (meta.regularMarketPrice/previous-1)*100 : null,asOf:meta.regularMarketTime ? new Date(meta.regularMarketTime*1000).toISOString():null,currency:meta.currency,history:closes.map((price,i)=>({time:result.timestamp?.[i],price})).filter(p=>Number.isFinite(p.price)),volume:meta.regularMarketVolume,cap:null};
}
