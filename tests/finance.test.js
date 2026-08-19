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
