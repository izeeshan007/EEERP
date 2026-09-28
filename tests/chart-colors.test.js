const test = require('node:test');
const assert = require('node:assert/strict');
const {createRegistry} = require('../public/chart-colors');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('large charts receive one non-repeating colour per label', () => {
    const registry = createRegistry();
    for (const count of [0, 1, 7, 10, 24, 50, 100]) {
        const labels = Array.from({length: count}, (_,i) => `Label ${i}`);
        const colors = registry.colors(`chart-${count}`,labels);
        assert.equal(colors.length,count);
        assert.equal(new Set(colors).size,count);
        assert.ok(colors.every(color => /^#[0-9a-f]{6}$|^hsl\(/.test(color)));
    }
});

test('filtering, sorting and new labels preserve existing colours', () => {
    const registry = createRegistry();
    const labels = ['Friends','Office','Sakinaka','Gym','Salman','Asim','Other','Online'];
    registry.seed('channels',labels);
    const original = registry.colors('channels',labels);
    assert.deepEqual(registry.colors('channels',labels.slice().reverse()),original.slice().reverse());
    assert.deepEqual(registry.colors('channels',['Office','Gym']),[original[1],original[3]]);
    registry.seed('channels',['A new source']);
    assert.deepEqual(registry.colors('channels',labels),original);
    assert.deepEqual(createRegistry().colors('channels',labels.slice().reverse()),original.slice().reverse());
});

test('real analytics assigns matching distinct colours to both circular charts', () => {
    const html = fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
    const start = html.indexOf('function buildAnalytics(');
    const source = html.slice(start,html.indexOf('function loadInvoiceLogoDataUrl()',start));
    const charts=[];
    const context = vm.createContext({
        analyticsColors:createRegistry(),yearSelect:{value:'ALL'},rangeSelect:{value:'ALL'},monthTable:{},
        salesChart:null,breakChart:null,topProductsChart:null,topRevenueChart:null,channelChart:null,inventoryPieChart:null,
        salesChartCanvas:{},breakChartCanvas:{},topProductsChartCanvas:{},topRevenueChartCanvas:{},channelChartCanvas:{},
        document:{getElementById:()=>({})},getNormalizedProductName:name=>name,
        Chart:function(canvas,config){charts.push(config);this.destroy=()=>{};}
    });
    vm.runInContext(source,context);
    const stock=Array.from({length:12},(_,i)=>({category:`Material ${i}`,cost:100,purchaseDate:'2026-01-01'}));
    const sales=Array.from({length:30},(_,i)=>({referenceSource:`Source ${i}`,productName:'Test',soldPrice:100,saleDate:'2026-01-01'}));
    context.buildAnalytics(stock,sales);
    const circular=charts.filter(c=>['pie','doughnut'].includes(c.type));
    assert.equal(circular.length,2);
    for(const chart of circular){
        const colors=chart.data.datasets[0].backgroundColor;
        assert.equal(colors.length,chart.data.labels.length);
        assert.equal(new Set(colors).size,chart.data.labels.length);
    }
});
