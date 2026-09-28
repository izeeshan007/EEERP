(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProductUnits = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const stockSizes = Object.freeze([50, 100, 250, 500, 1000]);
  const saleSizes = Object.freeze([12.5, 25, 50, 100]);
  const isBakhoor = row => String(row.category || row.saleCat || '').trim().toLowerCase() === 'bakhoor';
  const unit = row => isBakhoor(row) || row.category === 'Aroma Chemical' ? 'g' : 'ml';
  function formatSize(row) {
    const size = Number(row.size_ml || 0);
    return unit(row) === 'g' && size === 1000 ? '1 kg' : `${size} ${unit(row)}`;
  }
  function validate(row, kind) {
    if (!isBakhoor(row)) return null;
    if (!(kind === 'stock' ? stockSizes : saleSizes).includes(Number(row.size_ml))) {
      return kind === 'stock' ? 'Choose a Bakhoor pack of 50 g, 100 g, 250 g, 500 g or 1 kg.' : 'Choose a Bakhoor sale size of 12.5 g, 25 g, 50 g or 100 g.';
    }
    if (!Number.isInteger(Number(row.units)) || Number(row.units) < 1) return 'Enter a positive whole number of packs.';
    if (kind === 'stock' && (!Number.isFinite(Number(row.cost)) || Number(row.cost) < 0)) return 'Enter a valid non-negative purchase cost.';
    if (kind === 'sale' && (row.isFromBatch || row.sourceBatchId)) return 'Bakhoor cannot use a liquid perfume batch.';
    return null;
  }
  function stockPricePerUnit(row) {
    const quantity = Number(row.size_ml) * Number(row.units);
    return isBakhoor(row) ? (quantity > 0 ? Number(row.cost) / quantity : 0) :
      row.size_ml > 0 ? row.cost / row.size_ml : row.units > 0 ? row.cost / row.units : 0;
  }
  function bakhoorCost(rows, name, grams, packs = 1) {
    const selected = rows.filter(row => isBakhoor(row) && row.name === name && (!row.status || row.status === 'Active'));
    const weight = selected.reduce((sum, row) => sum + Number(row.size_ml || 0) * Number(row.units || 1), 0);
    const cost = selected.reduce((sum, row) => sum + Number(row.cost || 0), 0);
    return weight > 0 ? cost / weight * Number(grams) * Number(packs) : 0;
  }
  return { stockSizes, saleSizes, isBakhoor, unit, formatSize, validate, stockPricePerUnit, bakhoorCost };
});
