import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseChart} from '../server/market.js';
test('normalizes quote and excludes missing chart prices',()=>{
 const quote=parseChart('TCS',{chart:{result:[{meta:{regularMarketPrice:110,regularMarketTime:1700000000,currency:'INR'},timestamp:[1,2,3],indicators:{quote:[{close:[100,null,110]}]}}]}});
 assert.equal(quote.price,110);assert.ok(Math.abs(quote.change-10)<1e-8);assert.deepEqual(quote.history,[{time:1,price:100},{time:3,price:110}]);assert.equal(quote.cap,null);
});
test('rejects empty provider responses instead of creating a sample quote',()=>assert.throws(()=>parseChart('TCS',{chart:{result:null}}),/no price/));
test('does not invent a percentage when no prior close exists',()=>assert.equal(parseChart('TCS',{chart:{result:[{meta:{regularMarketPrice:100},indicators:{quote:[{close:[100]}]}}]}}).change,null));
