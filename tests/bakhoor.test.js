const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const units = require('../public/product-units');

test('Bakhoor pack sizes, decimal sale sizes, labels and validation', () => {
  assert.deepEqual(units.stockSizes, [50,100,250,500,1000]);
  assert.deepEqual(units.saleSizes, [12.5,25,50,100]);
  for (const size of units.stockSizes) assert.equal(units.validate({category:'Bakhoor',size_ml:size,units:2,cost:100},'stock'), null);
  for (const size of units.saleSizes) assert.equal(units.validate({category:'Bakhoor',size_ml:size,units:2},'sale'), null);
  assert.equal(units.formatSize({category:'Bakhoor',size_ml:1000}), '1 kg');
  assert.equal(units.formatSize({category:'Bakhoor',size_ml:12.5}), '12.5 g');
  assert.equal(units.formatSize({category:'Perfume',size_ml:50}), '50 ml');
  for (const patch of [{size_ml:20},{units:0},{units:1.5},{units:NaN},{isFromBatch:true},{sourceBatchId:'batch'}]) {
    assert.ok(units.validate({category:'Bakhoor',size_ml:25,units:1,...patch},'sale'));
  }
  assert.ok(units.validate({category:'Bakhoor',size_ml:100,units:1,cost:-1},'stock'));
});

test('cost uses grams times pack count and excludes unrelated/inactive stock', () => {
  const stock = [
    {category:'Bakhoor',name:'Royal',size_ml:1000,units:2,cost:4000,status:'Active'},
    {category:'Bakhoor',name:'Royal',size_ml:100,units:2,cost:600,status:'Active'},
    {category:'Bakhoor',name:'Royal',size_ml:50,units:1,cost:9999,status:'Loss'},
    {category:'Attar Oil',name:'Royal',size_ml:100,units:1,cost:9999,status:'Active'}
  ];
  assert.equal(units.stockPricePerUnit(stock[0]), 2);
  assert.equal(units.bakhoorCost(stock,'Royal',12.5,2), 4600/2200*25);
  assert.equal(units.bakhoorCost(stock,'Missing',50), 0);
  assert.equal(units.stockPricePerUnit({category:'Bottle',units:10,cost:100}), 10);
});

const html = fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
function extract(start,end) { return html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start))); }
test('actual UI renders gram inventory options, sale modes and invoice names', () => {
  const elements = {};
  for (const id of ['saleCat','saleSize','isFromBatch','productName','oilPercent','bottleCat','bottlePriceInput']) {
    elements[id] = { value:'',checked:false,disabled:false,style:{},setAttribute(key,value){this[key]=value;} };
  }
  let recalculated=0;
  const context = vm.createContext({...elements,ProductUnits:units,document:{getElementById:id=>elements[id]},calculateMfgCost(){recalculated++;}});
  vm.runInContext(extract('function getFieldsHTML(', 'function updateNameList('),context);
  vm.runInContext(extract('function formatProductName(', 'function invoiceLineTotal('),context);
  vm.runInContext(extract('function changeSaleMode(', '// Handles the New Raw Material Entry'),context);
  const stockHtml = context.getFieldsHTML('Bakhoor',{_id:'stock',size_ml:1000,units:2});
  assert.match(stockHtml,/value="1000" selected>1 kg/);
  assert.match(stockHtml,/id="e_size"/);
  assert.doesNotMatch(stockHtml,/\d+ ml/);
  elements.saleCat.value='Bakhoor';elements.isFromBatch.checked=true;
  context.changeSaleMode();
  assert.match(elements.saleSize.innerHTML,/12.5 g/);
  assert.doesNotMatch(elements.saleSize.innerHTML,/ml/);
  assert.equal(elements.isFromBatch.checked,false);
  assert.equal(elements.isFromBatch.disabled,true);
  assert.equal(elements.productName.list,'bakhoorList');
  assert.equal(elements.oilPercent.style.display,'none');
  assert.equal(context.formatProductName({productName:'Royal',category:'Bakhoor',size_ml:12.5}),'Royal 12.5 g Bakhoor');
  elements.saleCat.value='Perfume';context.changeSaleMode();
  assert.equal(elements.isFromBatch.disabled,false);
  assert.equal(elements.bottleCat.disabled,false);
  assert.equal(elements.productName.list,'oilList');
  assert.match(elements.saleSize.innerHTML,/30 ml/);
  assert.equal(elements.oilPercent.style.display,'inline-block');
  assert.equal(recalculated,2);
  assert.match(html,/desc \+= ` \$\{ProductUnits.formatSize\(sale\)\}`/);
});

test('Bakhoor API create/edit validates and persists gram records without liquid deductions', async t => {
  Object.assign(process.env,{NODE_ENV:'test',RENDER:'',RAILWAY_ENVIRONMENT_NAME:'',SESSION_SECRET:'bakhoor-test-only',MONGO_URI:'',MONGO_DIRECT_URI:''});
  const {app}=require('../server');
  const Stock=require('../models/Stock'),Sale=require('../models/Sale');
  const stock={category:'Bakhoor',name:'Royal',size_ml:1000,units:2,cost:4000};
  let savedStock,savedSale;
  t.mock.method(Stock,'create',async row=>(savedStock=row));
  t.mock.method(Stock,'findById',async ()=>({toObject:()=>stock}));
  t.mock.method(Stock,'findByIdAndUpdate',async (id,row)=>(savedStock=row));
  t.mock.method(Sale,'create',async row=>(savedSale=row));
  const sale={category:'Bakhoor',productName:'Royal',size_ml:12.5,units:2,soldPrice:100,manufacturingCost:50};
  t.mock.method(Sale,'findById',async ()=>({...sale,toObject:()=>sale}));
  t.mock.method(Sale,'findByIdAndUpdate',async (id,row)=>(savedSale=row));
  async function call(method,url,body) {
    const route=app._router.stack.find(layer=>layer.route?.path===url&&layer.route.methods[method]).route;
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
    await route.stack.at(-1).handle({body,params:{id:'test'}},res);
    return res;
  }
  assert.equal((await call('post','/api/stock',{...stock})).statusCode,200);
  assert.equal(savedStock.quantityUnit,'g');assert.equal(savedStock.pricePerUnit,2);
  await call('put','/api/stock/:id',{cost:5000});
  assert.equal(savedStock.quantityUnit,'g');assert.equal(savedStock.pricePerUnit,2.5);
  assert.equal((await call('post','/api/sales',{...sale})).statusCode,200);
  assert.equal(savedSale.quantityUnit,'g');assert.equal(savedSale.size_ml,12.5);
  await call('put','/api/sales/:id',{...sale,size_ml:25});
  assert.equal(savedSale.quantityUnit,'g');assert.equal(savedSale.size_ml,25);
  assert.equal((await call('put','/api/sales/:id',{size_ml:20})).statusCode,400);
  assert.equal((await call('post','/api/sales',{...sale,isFromBatch:true,sourceBatchId:'wrong'})).statusCode,400);
  assert.equal((await call('post','/api/stock',{...stock,size_ml:25})).statusCode,400);
});

test('sales calculator includes Bakhoor packaging without using oil or ethanol', () => {
  const elements = Object.fromEntries(['saleCat','saleSize','saleUnits','oilPercent','otherCost','bottlePriceInput','productName','boxNameSelect','pouchNameSelect','isFromBatch','mfg'].map(id=>[id,{value:'',checked:false}]));
  Object.assign(elements.saleCat,{value:'Bakhoor'});
  elements.saleSize.value='12.5';elements.saleUnits.value='2';
  elements.oilPercent.value='45';elements.otherCost.value='5';elements.bottlePriceInput.value='3';
  elements.productName.value='Royal';elements.boxNameSelect.value='NA';elements.pouchNameSelect.value='NA';
  const context=vm.createContext({...elements,ProductUnits:units,stockCache:[{category:'Bakhoor',name:'Royal',size_ml:1000,units:2,cost:4000,status:'Active'}],document:{getElementById:id=>elements[id]}});
  vm.runInContext(extract('function updateTotalFromManual()', 'function changeSaleMode()'),context);
  context.updateTotalFromManual();
  assert.equal(elements.mfg.value,'61.00');
});
