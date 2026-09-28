(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ChartColors = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    // A longer categorical palette, followed by generated colours rather than
    // cycling back to the first six/seven colours when more labels are present.
    const palette = [
        '#4f46e5', '#059669', '#f59e0b', '#db2777', '#0891b2', '#9333ea',
        '#dc2626', '#65a30d', '#ea580c', '#0369a1', '#a16207', '#475569',
        '#7c3aed', '#0f766e', '#be123c', '#84cc16', '#c026d3', '#2563eb',
        '#78350f', '#14b8a6', '#e879f9', '#636f14', '#fb7185', '#38bdf8'
    ];
    function createRegistry() {
        const groups = new Map();
        function seed(scope, labels) {
            if (!groups.has(scope)) groups.set(scope, new Map());
            const group = groups.get(scope);
            const missing = [...new Set(labels.map(String))].filter(label => !group.has(label)).sort();
            for (const label of missing) {
                const index = group.size;
                const extra = index - palette.length;
                const color = palette[index] || `hsl(${((extra * 137.507764 + 17) % 360).toFixed(4)}, ${60 + extra % 3 * 10}%, ${38 + extra % 4 * 8}%)`;
                group.set(label, color);
            }
        }
        function colors(scope, labels) {
            seed(scope, labels);
            return labels.map(label => groups.get(scope).get(String(label)));
        }
        return { seed, colors };
    }
    return { createRegistry };
});
