(() => {
	const riskLegendConfig = [
		{ code: 'ava', label: 'Avalanche', color: '#e31a1c' },
		{ code: 'dbf', label: 'Debris Flow', color: '#ff7f00' },
		{ code: 'bnk', label: 'Bank Erosion', color: '#ffd92f' },
		{ code: 'fld', label: 'Flood', color: '#1f78b4' },
		{ code: 'lds', label: 'Landslide', color: '#6a3d9a' },
		{ code: 'rkf', label: 'Rockfall', color: '#33a02c' },
		{ code: 'ufl', label: 'Urban Flooding', color: '#00bcd4' }
	];

	function getRiskLegendElements() {
		return {
			panel: document.getElementById('risk-zonation-legend'),
			list: document.getElementById('risk-zonation-legend-items')
		};
	}

	function isMapPreviewVisible() {
		const preview = document.getElementById('lake-map-preview');
		if (!preview) {
			return false;
		}
		return window.getComputedStyle(preview).display !== 'none';
	}

	function renderRiskZonationLegend() {
		const { panel, list } = getRiskLegendElements();
		if (!panel || !list) {
			return;
		}

		list.innerHTML = '';

		const enabledItems = riskLegendConfig.filter((item) => {
			const checkbox = document.getElementById(`risk-zonation-${item.code}-toggle`);
			return !!(checkbox && checkbox.checked);
		});

		if (!enabledItems.length) {
			panel.style.display = 'none';
			return;
		}

		const fragment = document.createDocumentFragment();
		enabledItems.forEach((item) => {
			const row = document.createElement('div');
			row.className = 'risk-zonation-legend-item';

			const swatch = document.createElement('span');
			swatch.className = 'risk-zonation-legend-swatch';
			swatch.style.backgroundColor = `${item.color}80`;
			swatch.style.borderColor = item.color;

			const label = document.createElement('span');
			label.className = 'risk-zonation-legend-label';
			label.textContent = item.label;

			row.appendChild(swatch);
			row.appendChild(label);
			fragment.appendChild(row);
		});

		list.appendChild(fragment);

		panel.classList.toggle('risk-zonation-legend--with-preview', isMapPreviewVisible());
		panel.style.display = 'block';
	}

	function bindRiskLegend() {
		riskLegendConfig.forEach((item) => {
			const checkbox = document.getElementById(`risk-zonation-${item.code}-toggle`);
			if (checkbox) {
				checkbox.addEventListener('change', renderRiskZonationLegend);
			}
		});

		const preview = document.getElementById('lake-map-preview');
		if (preview) {
			const previewObserver = new MutationObserver(() => renderRiskZonationLegend());
			previewObserver.observe(preview, {
				attributes: true,
				attributeFilter: ['style', 'class']
			});
		}

		renderRiskZonationLegend();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', bindRiskLegend);
	} else {
		bindRiskLegend();
	}

	window.renderRiskZonationLegend = renderRiskZonationLegend;
})();
