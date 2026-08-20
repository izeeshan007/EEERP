const test = require("node:test");
const assert = require("node:assert/strict");
const { finance } = require("../server");

test("invoice receivable includes discounts, taxes and shipping", () => {
  const total = finance.saleReceivableTotal({
    soldPrice: 1000,
    discount: 100,
    cgstPercent: 9,
    sgstPercent: 9,
    shippingCharge: 50
  });
  assert.equal(total, 1112);
});

test("payment status distinguishes unpaid, partial and paid", () => {
  assert.equal(finance.derivePaymentStatus(0, 1000), "UNPAID");
  assert.equal(finance.derivePaymentStatus(250, 1000), "PARTIAL");
  assert.equal(finance.derivePaymentStatus(1000, 1000), "PAID");
  assert.equal(finance.derivePaymentStatus(0, 0, true), "NOT_APPLICABLE");
});

test("sample entries are forced to zero revenue and acquisition expense", () => {
  const sale = finance.prepareSaleAccounting({
    soldPrice: 599,
    manufacturingCost: 180,
    distributorMargin: 20,
    units: 1,
    customerName: "XYZ",
    counterpartyType: "customer",
    isAcquisitionCost: true,
    isPaid: true
  });
  assert.equal(sale.soldPrice, 0);
  assert.equal(sale.paymentStatus, "NOT_APPLICABLE");
  assert.equal(sale.amountReceived, 0);
  assert.equal(sale.profit, -200);
  assert.equal(finance.acquisitionExpense(sale), 200);
  assert.equal(sale.counterpartyKey, "customer:xyz");
});

test("legacy zero-price sale is recognized as acquisition", () => {
  assert.equal(finance.isAcquisitionSale({ soldPrice: 0 }), true);
  assert.equal(finance.isAcquisitionSale({ soldPrice: 499 }), false);
});

test("website 30 ml regular and gift variants calculate packaging and miscellaneous cost", () => {
  const stock = [
    { category: "Attar Oil", name: "Purple OUD", size_ml: 100, units: 1, cost: 200, status: "Active" },
    { category: "Aroma Chemical", name: "Ethanol", size_ml: 1000, units: 1, cost: 100, status: "Active" },
    { category: "Bottle", subCategory: "Moderate", name: "30ml Bottle", size_ml: 30, units: 10, cost: 200, status: "Active" },
    { category: "Box", name: "30/50 Eco", units: 10, cost: 100, status: "Active" },
    { category: "Box", name: "30/50", units: 10, cost: 300, status: "Active" }
  ];
  const regular = finance.calculateWebsiteManufacturingCost({ name: "Purple OUD", category: "Perfume", size: "30 ml", qty: 1 }, stock);
  const gift = finance.calculateWebsiteManufacturingCost({ name: "Purple OUD", category: "Perfume", size: "30 ml Gift", qty: 1 }, stock);
  assert.equal(regular.bottleQuality, "Moderate");
  assert.equal(regular.boxCost, 10);
  assert.equal(regular.miscellaneousCost, 5);
  assert.equal(gift.boxCost, 30);
  assert.equal(gift.miscellaneousCost, 30);
  assert.ok(gift.total > regular.total);
});
