document.addEventListener('DOMContentLoaded', function () {
	var optionsDiv = document.getElementById('options');
	var statusDiv = document.getElementById('status');
	var progressText = document.getElementById('progressText');
	var chatDiv = document.getElementById('chat');
	var titleEl = document.getElementById('title');
	var toolbarDiv = document.getElementById('toolbar');
	var backBtn = document.getElementById('backBtn');
	var imageOnlyBtn = document.getElementById('imageOnlyBtn');
	var copyBtn = document.getElementById('copyBtn');
	var mdBtn = document.getElementById('mdBtn');
	var csvBtn = document.getElementById('csvBtn');
	var pdfBtn = document.getElementById('pdfBtn');
	var toast = document.getElementById('toast');
	var startBtn = document.getElementById('startBtn');
	var viewResultsBtn = document.getElementById('viewResultsBtn');
	var loadedSessionEmpty = document.getElementById('loadedSessionEmpty');
	var startDateInput = document.getElementById('startDateInput');
	var endDateInput = document.getElementById('endDateInput');
	var selectionSummary = document.getElementById('selectionSummary');
	var rangeError = document.getElementById('rangeError');
	var chatTarget = document.getElementById('chatTarget');
	var quickButtons = Array.from(document.querySelectorAll('.range-btn'));

	var activeTabId = null;
	var extractedRows = [];
	var hasStoredPayload = false;
	var imageOnlyMode = false;
	var currentResultPayload = null;
	var currentResultImageMap = {};
	var selectedRangeMode = 'quick';
	var selectedQuickDays = -1;
	var selectedQuickLabel = 'Visible Messages';
	var exportButtonStateBeforePdf = null;
	var currentResultMeta = {
		chatName: '',
		messageCount: 0,
		imageCount: 0,
		modeLabel: '',
		periodLabel: '',
		extractionDateLabel: ''
	};

	function showToast(text) {
		toast.textContent = text;
		toast.classList.add('show');
		setTimeout(function () { toast.classList.remove('show'); }, 10000);
	}

	function escapeHtml(text) {
		return String(text || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function renderSelectorDiagnostics(diagnostics) {
		if (!diagnostics || !diagnostics.components) return '';
		var config = diagnostics.configComponents || diagnostics.tidComponents || [];
		var aria = diagnostics.ariaComponents || [];
		var fallback = diagnostics.fallbackComponents || [];
		var unresolved = diagnostics.unresolvedComponents || [];
		var parts = [];
		if (diagnostics.activeStrategy) parts.push('Run: ' + diagnostics.activeStrategy);
		if (config.length > 0) parts.push('Config: ' + config.join(', '));
		if (aria.length > 0) parts.push('ARIA: ' + aria.join(', '));
		if (fallback.length > 0) parts.push('Fallback: ' + fallback.join(', '));
		if (unresolved.length > 0) parts.push('Unresolved: ' + unresolved.join(', '));
		if (parts.length === 0) return '';
		return '<div class="selector-diag">' + escapeHtml(parts.join(' | ')) + '</div>';
	}

	function buildExportMetadataPairs(meta) {
		meta = meta || currentResultMeta || {};
		return [
			['Chat Name', meta.chatName || 'UnknownChat'],
			['Date of Extraction', meta.extractionDateLabel || formatHeaderDate(new Date())],
			['Mode of Extraction', meta.modeLabel || 'Messages'],
			['Period of Extraction', meta.periodLabel || 'Unknown'],
			['Number of Messages', String(meta.messageCount || 0)],
			['Number of Images Extracted', String(meta.imageCount || 0)]
		];
	}

	function buildResultMetaFromPayload(payload) {
		var rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
		var periodBounds = getExtractedPeriodBounds(rows);
		var messageCount = (payload && payload.count) || rows.length || 0;
		var imageCount = Array.isArray(payload && payload.imageIds) ? payload.imageIds.length : 0;
		return {
			chatName: (payload && payload.chatName) || parseChatNameFromTitle(document.title),
			messageCount: messageCount,
			imageCount: imageCount,
			modeLabel: getExtractionModeLabel(payload),
			periodLabel: buildPeriodLabel(periodBounds.start, periodBounds.end),
			extractionDateLabel: formatHeaderDate(new Date())
		};
	}

	function buildResultsHeaderHtml(meta) {
		meta = meta || currentResultMeta || {};
		var periodText = meta.periodLabel || 'Actual extracted period unavailable';
		var modeText = meta.modeLabel || 'Messages';
		var extractionDateText = meta.extractionDateLabel || formatHeaderDate(new Date());
		var messageCountText = String(meta.messageCount || 0);
		var imageCountText = String(meta.imageCount || 0);
		var metaPairs = [
			['Date of Extraction', extractionDateText],
			['Number of Messages', messageCountText],
			['Number of Images Extracted', imageCountText]
		];
		var summaryLine = escapeHtml(modeText) + ' &middot; ' + escapeHtml(periodText);
		var details = metaPairs.map(function (pair) {
			return '<div class="results-meta-item"><div class="results-meta-label">' + escapeHtml(pair[0]) + '</div><div class="results-meta-value">' + escapeHtml(pair[1]) + '</div></div>';
		}).join('');
		return '' +
			'<div class="results-summary-card">' +
				'<div class="results-summary-top">' +
					'<div class="results-summary-copy">' +
						'<div class="results-summary-eyebrow">Extraction summary</div>' +
						'<h2 class="results-summary-title">' + escapeHtml(meta.chatName || 'UnknownChat') + '</h2>' +
						'<div class="results-summary-subtitle">' + summaryLine + '</div>' +
					'</div>' +
				'</div>' +
				'<div class="results-meta-grid">' + details + '</div>' +
			'</div>';
	}

	function buildRenderedResultsHtml(payload, meta) {
		var selectorDiagHtml = renderSelectorDiagnostics(payload.selectorDiagnostics);
		var summaryHtml = buildResultsHeaderHtml(meta);
		var transcriptHtml = '<div id="transcript">' + sanitizeImageHtml(payload.html || '<p>No messages found.</p>') + '</div>';
		return selectorDiagHtml + summaryHtml + transcriptHtml;
	}

	// Convert the transcript HTML to Markdown
	function htmlToMarkdown(container, meta) {
		var lines = [];
		var exportMeta = meta || currentResultMeta || {};
		lines.push('# Chat Transcript - ' + (exportMeta.chatName || 'UnknownChat'));
		lines.push('');
		buildExportMetadataPairs(exportMeta).forEach(function (pair) {
			lines.push('- ' + pair[0] + ': ' + pair[1]);
		});
		lines.push('');
		container.querySelectorAll('.message').forEach(function (msg) {
			var hr = msg.querySelector('hr');
			var bold = msg.querySelector('b');
			var time = msg.querySelector('span');
			if (hr && bold) {
				lines.push('---');
				lines.push('**' + bold.textContent + '** ' + (time ? time.textContent : ''));
				lines.push('');
			}
			var divider = msg.querySelector('.divider');
			if (divider) {
				lines.push('---');
				lines.push(divider.textContent.trim());
				lines.push('---');
				lines.push('');
			}
			var section = msg.querySelector('section');
			if (section) {
				lines.push('> ' + section.innerText.trim().replace(/\n/g, '\n> '));
				lines.push('');
			}
		});
		return lines.join('\n');
	}
	
	function todayDateString() {
		var now = new Date();
		var y = now.getFullYear();
		var m = String(now.getMonth() + 1).padStart(2, '0');
		var d = String(now.getDate()).padStart(2, '0');
		return y + '-' + m + '-' + d;
	}

	function formatPdfDateTime(date) {
		if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
		var d = String(date.getDate()).padStart(2, '0');
		var m = String(date.getMonth() + 1).padStart(2, '0');
		var y = date.getFullYear();
		var h = String(date.getHours()).padStart(2, '0');
		var mi = String(date.getMinutes()).padStart(2, '0');
		return d + '/' + m + '/' + y + ' ' + h + ':' + mi;
	}

	function formatHeaderDate(date) {
		if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
		var d = String(date.getDate()).padStart(2, '0');
		var m = String(date.getMonth() + 1).padStart(2, '0');
		var y = date.getFullYear();
		return d + '/' + m + '/' + y;
	}

	function getPdfFontFamily(sourceElement) {
		var computedStyle = sourceElement ? window.getComputedStyle(sourceElement) : null;
		var baseFamily = computedStyle && computedStyle.fontFamily ? computedStyle.fontFamily : 'Arial, sans-serif';
		return baseFamily + ', Noto Sans CJK SC, WenQuanYi Zen Hei, PingFang SC, Microsoft YaHei, sans-serif';
	}

	function parseChatNameFromTitle(title) {
		if (!title) return 'Current Teams chat';
		var cleaned = title
			.replace(/\s*-\s*Microsoft Teams\s*$/i, '')
			.replace(/\s*\|\s*Microsoft Teams\s*$/i, '')
			.trim();
		return cleaned || 'Current Teams chat';
	}

	function sanitizeFilenamePart(value) {
		return String(value || '').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
	}

	function parseTimestampValue(value) {
		if (!value) return null;
		var parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	function getExtractedPeriodBounds(rows) {
		if (!Array.isArray(rows) || rows.length === 0) return { start: null, end: null };
		var timestamps = rows
			.map(function (row) { return parseTimestampValue(row && row.timestamp); })
			.filter(function (date) { return !!date; })
			.sort(function (a, b) { return a.getTime() - b.getTime(); });
		if (timestamps.length === 0) return { start: null, end: null };
		return { start: timestamps[0], end: timestamps[timestamps.length - 1] };
	}

	function getExtractionModeLabel(payload) {
		if (payload && payload.modeLabel) return String(payload.modeLabel).trim();
		if (selectedRangeMode === 'custom') return 'Custom Date Range';
		if (selectedQuickDays < 0) return 'Visible Messages';
		if (selectedQuickDays === 0) return 'All Messages';
		if (selectedQuickLabel) return String(selectedQuickLabel).trim();
		return 'Messages';
	}

	function buildPeriodLabel(startDate, endDate) {
		if (!startDate && !endDate) return '';
		if (startDate && endDate) {
			return formatPdfDateTime(startDate) + '-' + formatPdfDateTime(endDate);
		}
		var single = startDate || endDate;
		return single ? formatPdfDateTime(single) : '';
	}

	function renderSelectionSummary() {
		if (selectedRangeMode === 'quick') {
			selectionSummary.textContent = 'Selected: ' + selectedQuickLabel;
			return;
		}
		selectionSummary.textContent = 'Selected: ' + startDateInput.value + ' to ' + endDateInput.value + ' (inclusive)';
	}

	function setRangeError(message) {
		if (!message) {
			rangeError.style.display = 'none';
			rangeError.textContent = '';
			return;
		}
		rangeError.style.display = 'block';
		rangeError.textContent = message;
	}

	function setSelectedQuickButton(button) {
		quickButtons.forEach(function (b) {
			b.classList.toggle('selected', b === button);
		});
	}

	function syncLoadedSessionUi() {
		var hasRows = extractedRows && extractedRows.length > 0;
		var showLoaded = hasRows || hasStoredPayload;
		var tooltip = document.getElementById('loadedSessionTooltip');
		
		if (viewResultsBtn) {
			if (showLoaded) {
				viewResultsBtn.disabled = false;
				if (tooltip) tooltip.textContent = "Access previously captured data instantly. No new extraction required.";
			} else {
				viewResultsBtn.disabled = true;
				if (tooltip) tooltip.textContent = "No recent extractions found. Run a new extraction first.";
			}
		}
	}

	function updateResultsModeButton() {
		if (!imageOnlyBtn) return;
		imageOnlyBtn.classList.toggle('selected', imageOnlyMode);
		imageOnlyBtn.setAttribute('aria-pressed', imageOnlyMode ? 'true' : 'false');
		imageOnlyBtn.setAttribute('title', imageOnlyMode ? 'Show full transcript' : 'Show images only');
		imageOnlyBtn.setAttribute('aria-label', imageOnlyMode ? 'Show full transcript' : 'Show images only');
	}

	function updateExportAvailability() {
		if (mdBtn) mdBtn.disabled = imageOnlyMode || extractedRows.length === 0;
		if (csvBtn) csvBtn.disabled = imageOnlyMode || extractedRows.length === 0;
		if (pdfBtn) pdfBtn.disabled = false;
	}

	function setImageOnlyMode(nextValue) {
		imageOnlyMode = !!nextValue;
		updateResultsModeButton();
		applyCurrentResultsView();
	}

	function applyCurrentResultsView() {
		if (!currentResultPayload) return;
		if (imageOnlyMode) {
			renderImageOnlyResult(currentResultPayload, currentResultImageMap);
			return;
		}
		renderStoredResult(currentResultPayload, currentResultImageMap);
	}

	function rehydrateImages(transcript, imageMap) {
		if (!transcript) return;
		if (imageMap) {
			Array.from(transcript.querySelectorAll('img[data-image-id]')).forEach(function (imgEl) {
				var id = imgEl.getAttribute('data-image-id');
				if (imageMap[id] && imageMap[id].url) {
					imgEl.setAttribute('src', imageMap[id].url);
					return;
				}
				var fallbackSrc = imgEl.getAttribute('data-orig-src') || imgEl.getAttribute('data-gallery-src');
				if (fallbackSrc && !isBlobUrl(fallbackSrc)) {
					imgEl.setAttribute('src', fallbackSrc);
				}
			});
		}
		Array.from(transcript.querySelectorAll('img')).forEach(function (imgEl) {
			if (imgEl.getAttribute('src')) return;
			var fallbackSrc = imgEl.getAttribute('data-orig-src') || imgEl.getAttribute('data-gallery-src');
			if (fallbackSrc && !isBlobUrl(fallbackSrc)) imgEl.setAttribute('src', fallbackSrc);
		});
	}

	function restoreOptions(errorHtml) {
		optionsDiv.style.display = 'block';
		statusDiv.style.display = 'none';
		toolbarDiv.style.display = 'none';
		startBtn.disabled = false;
		if (errorHtml) {
			chatDiv.style.display = 'block';
			chatDiv.innerHTML = errorHtml;
		} else {
			chatDiv.style.display = 'none';
			chatDiv.innerHTML = '';
		}
		syncLoadedSessionUi();
	}
	
	// Show options while keeping extracted results in memory (used by Back button)
	function showOptionsFromResults() {
		optionsDiv.style.display = 'block';
		statusDiv.style.display = 'none';
		toolbarDiv.style.display = 'none';
		chatDiv.style.display = 'none';
		startBtn.disabled = false;
		syncLoadedSessionUi();
	}
	
	// Restore results view from options without re-extracting
	function showResultsFromOptions() {
		optionsDiv.style.display = 'none';
		statusDiv.style.display = 'none';
		toolbarDiv.style.display = 'flex';
		chatDiv.style.display = 'block';
	}

	function validateCustomRange() {
		var start = startDateInput.value;
		var end = endDateInput.value;
		var today = todayDateString();
		if (!start || !end) {
			setRangeError('Start date and end date are required.');
			return false;
		}
		if (start > today || end > today) {
			setRangeError('Date cannot be later than today.');
			return false;
		}
		if (start > end) {
			setRangeError('Start date must be earlier than or equal to end date.');
			return false;
		}
		setRangeError('');
		return true;
	}

	function neutralizeFormulaValue(value) {
		var text = String(value || '');
		if (/^\s*[=+\-@]/.test(text)) {
			return "'" + text;
		}
		return text;
	}

	function csvEscape(value) {
		var text = neutralizeFormulaValue(value)
			.replace(/\r\n/g, '\n')
			.replace(/[\r\u2028\u2029]/g, '\n');
		if (/[",\n]/.test(text)) {
			return '"' + text.replace(/"/g, '""') + '"';
		}
		return text;
	}

	function rowsToCsv(rows, meta) {
		var exportMeta = meta || currentResultMeta || {};
		var lines = [['Field', 'Value'].join(',')];
		buildExportMetadataPairs(exportMeta).forEach(function (pair) {
			lines.push([csvEscape(pair[0]), csvEscape(pair[1])].join(','));
		});
		lines.push('');
		var header = ['messageId', 'timestamp', 'author', 'contentText'];
		lines.push(header.join(','));
		rows.forEach(function (row) {
			lines.push([
				csvEscape(row.messageId),
				csvEscape(row.timestamp),
				csvEscape(row.author),
				csvEscape(row.contentText)
			].join(','));
		});
		return lines.join('\r\n');
	}

	function downloadBlob(content, mimeType, extension, options, meta) {
		var parts = [];
		if (options && options.withUtf8Bom) {
			parts.push('\uFEFF');
		}
		parts.push(content);
		var blob = new Blob(parts, { type: mimeType });
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = buildExportFileName(extension, meta);
		a.click();
		URL.revokeObjectURL(url);
	}

	function buildExportFileName(extension, meta) {
		meta = meta || currentResultMeta;
		var now = new Date();
		var y = now.getFullYear();
		var mo = String(now.getMonth() + 1).padStart(2, '0');
		var d = String(now.getDate()).padStart(2, '0');
		var h = String(now.getHours()).padStart(2, '0');
		var mi = String(now.getMinutes()).padStart(2, '0');
		var timestamp = y + mo + d + h + mi;

		var chatName = meta.chatName || 'UnknownChat';
		chatName = sanitizeFilenamePart(chatName) || 'UnknownChat';

		return chatName + '_' + timestamp + '.' + extension;
	}

	function getPdfConstructor() {
		if (typeof html2canvas !== 'function') {
			throw new Error('html2canvas is not available.');
		}
		if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function') {
			throw new Error('jsPDF is not available.');
		}
		return window.jspdf.jsPDF;
	}

	function buildPdfHeaderHtml(meta) {
		meta = meta || currentResultMeta || {};
		var pairs = buildExportMetadataPairs(meta);
		var headerRows = pairs.map(function (pair) {
			return '<div style="display:flex; gap:8px; margin:2px 0; break-inside:avoid;"><span style="font-weight:700; white-space:nowrap;">' + escapeHtml(pair[0]) + ':</span><span style="flex:1; word-break:break-word;">' + escapeHtml(pair[1]) + '</span></div>';
		}).join('');
		return '<div style="border:1px solid #bfc8d0; background:#f7f9fb; border-radius:8px; padding:12px 14px; box-sizing:border-box;">' +
			'<div style="font-size:15px; font-weight:700; margin-bottom:8px;">' + escapeHtml(meta.chatName || 'UnknownChat') + '</div>' +
			'<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 14px; font-size:10px; line-height:1.35;">' +
			headerRows +
			'</div>' +
			'</div>';
	}

	function createPdfRenderRoot(transcriptContainer, meta) {
		var wrapper = document.createElement('div');
		var transcriptWidth = Math.max(transcriptContainer.scrollWidth || 0, transcriptContainer.clientWidth || 0, 760);
		var computedStyle = window.getComputedStyle(transcriptContainer);
		wrapper.style.position = 'fixed';
		wrapper.style.left = '-10000px';
		wrapper.style.top = '0';
		wrapper.style.zIndex = '-1';
		wrapper.style.pointerEvents = 'none';
		wrapper.style.background = '#fff';
		wrapper.style.width = transcriptWidth + 'px';
		wrapper.style.padding = '16px';
		wrapper.style.boxSizing = 'border-box';
		wrapper.style.color = '#111';
		wrapper.style.fontFamily = getPdfFontFamily(transcriptContainer);
		wrapper.style.lineHeight = computedStyle.lineHeight || '1.4';

		var header = document.createElement('div');
		header.id = 'pdf-header-clone';
		header.style.width = '100%';
		header.style.marginBottom = '14px';
		header.style.fontFamily = getPdfFontFamily(transcriptContainer);
		header.innerHTML = buildPdfHeaderHtml(meta);

		var clone = transcriptContainer.cloneNode(true);
		clone.id = 'pdf-transcript-clone';
		clone.style.width = '100%';
		clone.style.margin = '0';
		wrapper.appendChild(clone);
		wrapper.insertBefore(header, clone);
		document.body.appendChild(wrapper);
		return { wrapper: wrapper, header: header, clone: clone };
	}

	function removePdfRenderRoot(renderRoot) {
		if (renderRoot && renderRoot.wrapper && renderRoot.wrapper.parentNode) {
			renderRoot.wrapper.parentNode.removeChild(renderRoot.wrapper);
		}
	}

	function replaceImageWithPdfFallback(imageEl) {
		if (!imageEl || !imageEl.parentNode) return;
		var rect = imageEl.getBoundingClientRect();
		var fallback = document.createElement('span');
		fallback.textContent = '[Image unavailable in PDF]';
		fallback.style.display = 'inline-flex';
		fallback.style.alignItems = 'center';
		fallback.style.justifyContent = 'center';
		fallback.style.padding = '6px 8px';
		fallback.style.margin = '2px 0';
		fallback.style.border = '1px dashed #999';
		fallback.style.borderRadius = '4px';
		fallback.style.background = '#f5f5f5';
		fallback.style.color = '#555';
		fallback.style.fontSize = '12px';
		fallback.style.fontStyle = 'italic';
		if (rect.width > 20) {
			fallback.style.width = Math.round(rect.width) + 'px';
		}
		if (rect.height > 20) {
			fallback.style.minHeight = Math.round(rect.height) + 'px';
		}
		imageEl.parentNode.replaceChild(fallback, imageEl);
	}

	function imageToDataUrlFromElement(imageEl) {
		if (!imageEl || !imageEl.complete || !imageEl.naturalWidth || !imageEl.naturalHeight) {
			throw new Error('Image is not available for conversion.');
		}
		var canvas = document.createElement('canvas');
		canvas.width = imageEl.naturalWidth;
		canvas.height = imageEl.naturalHeight;
		var context = canvas.getContext('2d');
		context.drawImage(imageEl, 0, 0);
		return canvas.toDataURL('image/png');
	}

	function waitForImageReady(imageEl, timeoutMs) {
		if (!imageEl) return Promise.resolve(false);
		if (imageEl.complete && imageEl.naturalWidth > 0) return Promise.resolve(true);
		return new Promise(function (resolve) {
			var done = false;
			var timer = setTimeout(function () {
				if (done) return;
				done = true;
				cleanup();
				resolve(imageEl.complete && imageEl.naturalWidth > 0);
			}, timeoutMs || 2000);

			function cleanup() {
				imageEl.removeEventListener('load', onLoad);
				imageEl.removeEventListener('error', onError);
				clearTimeout(timer);
			}

			function onLoad() {
				if (done) return;
				done = true;
				cleanup();
				resolve(true);
			}

			function onError() {
				if (done) return;
				done = true;
				cleanup();
				resolve(false);
			}

			imageEl.addEventListener('load', onLoad);
			imageEl.addEventListener('error', onError);
		});
	}

	function fetchImageAsBlobUrl(src) {
		if (!src || /^(data:|blob:)/i.test(src)) {
			return Promise.resolve('');
		}
		return new Promise(function (resolve) {
			chrome.runtime.sendMessage({ type: 'fetch-image-for-pdf', url: src }, function (response) {
				if (!response || response.status === 'error' || !response.buffer) {
					resolve('');
					return;
				}
				try {
					var blob = new Blob([response.buffer], { type: response.contentType || 'application/octet-stream' });
					resolve(URL.createObjectURL(blob));
				} catch (e) {
					resolve('');
				}
			});
		}).catch(function () {
			return '';
		});
	}

	function releasePdfTempUrls(transcriptClone) {
		Array.from(transcriptClone.querySelectorAll('img[data-pdf-temp-url="1"]')).forEach(function (imgEl) {
			var src = imgEl.getAttribute('src');
			if (src && /^blob:/i.test(src)) {
				try {
					URL.revokeObjectURL(src);
				} catch (e) {
					// Ignore cleanup errors.
				}
			}
			imgEl.removeAttribute('data-pdf-temp-url');
		});
	}

	function normalizePdfCloneText(transcriptClone) {
		Array.from(transcriptClone.querySelectorAll('*')).forEach(function (node) {
			if (node.tagName === 'IMG' || node.tagName === 'CANVAS' || node.tagName === 'SVG') return;
			node.style.color = '#111';
			node.style.webkitTextFillColor = '#111';
			node.style.opacity = '1';
		});
	}

	function renderPdfHeaderCanvas(headerClone) {
		if (!headerClone) return Promise.resolve(null);
		return html2canvas(headerClone, {
			backgroundColor: '#ffffff',
			scale: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
			logging: false,
			useCORS: false,
			allowTaint: false,
			windowWidth: Math.max(document.documentElement.clientWidth, headerClone.scrollWidth || 0)
		});
	}

	function embedTranscriptImagesForPdf(sourceTranscript, transcriptClone) {
		var cloneImages = Array.from(transcriptClone.querySelectorAll('img'));
		var sourceImages = Array.from(sourceTranscript.querySelectorAll('img'));
		if (cloneImages.length === 0) return Promise.resolve();
		var batchSize = 6;

		function getImageDataUrl(imageEl) {
			if (!imageEl) return Promise.resolve('');
			var src = imageEl.currentSrc || imageEl.getAttribute('src') || '';
			if (!src) {
				src = imageEl.getAttribute('data-src') || imageEl.getAttribute('data-orig-src') || imageEl.getAttribute('data-gallery-src') || '';
			}
			if (!src) return Promise.resolve('');
			return fetch(src).then(function (response) {
				if (!response.ok) throw new Error('Unable to fetch rendered image for PDF.');
				return response.blob();
			}).then(function (blob) {
				if (!blob || !blob.size) return '';
				return URL.createObjectURL(blob);
			}).catch(function () {
				if (/^data:/i.test(src)) return src;
				return '';
			});
		}

		function processImage(imageEl, sourceImageEl) {
			// Check if source image is already broken (naturalWidth === 0)
			if (sourceImageEl && (sourceImageEl.naturalWidth === 0 || !sourceImageEl.complete)) {
				replaceImageWithPdfFallback(imageEl);
				return Promise.resolve();
			}
			return getImageDataUrl(imageEl).then(function (resolvedSrc) {
				if (!resolvedSrc) {
					replaceImageWithPdfFallback(imageEl);
					return;
				}
				imageEl.setAttribute('src', resolvedSrc);
				imageEl.removeAttribute('srcset');
				imageEl.removeAttribute('sizes');
				imageEl.removeAttribute('crossorigin');
				return waitForImageReady(imageEl, 5000).then(function (ready) {
					if (!ready) {
						replaceImageWithPdfFallback(imageEl);
					}
				});
			}).catch(function (err) {
				// Catch any errors (fetch failures, etc.) and replace with fallback
				replaceImageWithPdfFallback(imageEl);
			});
		}

		var cursor = 0;
		function runBatch() {
			if (cursor >= cloneImages.length) return Promise.resolve();
			var batch = cloneImages.slice(cursor, cursor + batchSize);
			var sourceBatch = sourceImages.slice(cursor, cursor + batchSize);
			cursor += batchSize;
			return Promise.all(batch.map(function (imageEl) {
				var sourceImageEl = sourceBatch.shift();
				return processImage(imageEl, sourceImageEl);
			})).then(runBatch);
		}

		return runBatch();
	}

	function renderPdfCanvas(transcriptClone) {
		normalizePdfCloneText(transcriptClone);
		// For large transcripts, reduce scale to avoid canvas size limits
		var scrollHeight = transcriptClone.scrollHeight || 0;
		var isLargeTranscript = scrollHeight > 4000;
		var scale = isLargeTranscript ? 1 : Math.max(1, Math.min(2, window.devicePixelRatio || 1));
		
		return html2canvas(transcriptClone, {
			backgroundColor: '#ffffff',
			scale: scale,
			logging: false,
			useCORS: false,
			allowTaint: false,
			windowWidth: Math.max(document.documentElement.clientWidth, transcriptClone.scrollWidth || 0),
			onclone: function(clonedDoc) {
				// Ensure images are fully loaded in the clone before rendering
				var images = clonedDoc.querySelectorAll('img');
				return Promise.all(Array.from(images).map(function(img) {
					if (img.complete) return Promise.resolve();
					return new Promise(function(resolve) {
						img.onload = resolve;
						img.onerror = resolve;
						setTimeout(resolve, 3000); // Timeout fallback
					});
				}));
			}
		});
	}

	function buildPdfFromCanvas(canvas, headerCanvas, JsPdfCtor, meta) {
		var pdf = new JsPdfCtor({
			orientation: 'portrait',
			unit: 'pt',
			format: 'a4',
			compress: true	
		});	
		var pageWidth = pdf.internal.pageSize.getWidth();
		var pageHeight = pdf.internal.pageSize.getHeight();
		var margin = 24;
		var headerGap = 12;
		var usableWidth = pageWidth - margin * 2;
		var headerHeight = 0;
		if (headerCanvas && headerCanvas.width && headerCanvas.height) {
			headerHeight = (headerCanvas.height * usableWidth) / headerCanvas.width;
		}
		var usableHeight = pageHeight - margin * 2 - headerHeight - headerGap;
		var imgData = canvas.toDataURL('image/png');
		var imgWidth = usableWidth;
		var imgHeight = (canvas.height * imgWidth) / canvas.width;
		var renderedHeight = 0;
		var headerImgData = headerCanvas && headerCanvas.width && headerCanvas.height ? headerCanvas.toDataURL('image/png') : '';

		while (renderedHeight < imgHeight) {
			if (renderedHeight > 0) {
				pdf.addPage();
			}
			if (headerImgData) {
				pdf.addImage(headerImgData, 'PNG', margin, margin, imgWidth, headerHeight, undefined, 'FAST');
			}
			pdf.addImage(imgData, 'PNG', margin, margin + headerHeight + headerGap - renderedHeight, imgWidth, imgHeight, undefined, 'FAST');
			renderedHeight += usableHeight;
		}
		return pdf;
	}

	function exportTranscriptToPdf(transcriptContainer) {
		var JsPdfCtor = getPdfConstructor();
		var renderRoot = createPdfRenderRoot(transcriptContainer, currentResultMeta || {});
		return Promise.all([
			renderPdfHeaderCanvas(renderRoot.header),
			embedTranscriptImagesForPdf(transcriptContainer, renderRoot.clone).then(function () {
				return renderPdfCanvas(renderRoot.clone);
			})
		]).then(function (results) {
			var headerCanvas = results[0];
			var bodyCanvas = results[1];
			if (!bodyCanvas || !bodyCanvas.width || !bodyCanvas.height) {
				throw new Error('Unable to render transcript for PDF.');
			}
			var pdf = buildPdfFromCanvas(bodyCanvas, headerCanvas, JsPdfCtor, currentResultMeta || {});
			downloadBlob(pdf.output('arraybuffer'), 'application/pdf', 'pdf', null, currentResultMeta);
		})
			.then(function () {
				removePdfRenderRoot(renderRoot);
			})
			.catch(function (err) {
				removePdfRenderRoot(renderRoot);
				throw err;
			});
	}

	function setPdfExportState(state) {
		if (!pdfBtn) return;

		if (state === 'inProgress') {
			exportButtonStateBeforePdf = {
				copyDisabled: copyBtn.disabled,
				mdDisabled: mdBtn.disabled,
				csvDisabled: csvBtn.disabled,
				pdfDisabled: pdfBtn.disabled
			};
			copyBtn.disabled = true;
			mdBtn.disabled = true;
			csvBtn.disabled = true;
			pdfBtn.disabled = true;
			showToast('Exporting PDF...');
			return;
		}

		if (exportButtonStateBeforePdf) {
			copyBtn.disabled = exportButtonStateBeforePdf.copyDisabled;
			mdBtn.disabled = exportButtonStateBeforePdf.mdDisabled;
			csvBtn.disabled = exportButtonStateBeforePdf.csvDisabled;
			pdfBtn.disabled = exportButtonStateBeforePdf.pdfDisabled;
			exportButtonStateBeforePdf = null;
		}

		if (state === 'success') {
			showToast('PDF downloaded!');
		} else if (state === 'failure') {
			showToast('PDF export failed.');
		}
	}

	function exportTranscriptAsPdf() {
		var transcript = chatDiv.querySelector('#transcript');
		if (!transcript) {
			showToast('No transcript to export.');
			return;
		}

		setPdfExportState('inProgress');
		Promise.resolve().then(function () {
			return exportTranscriptToPdf(transcript);
		}).then(function () {
			setPdfExportState('success');
		}).catch(function (err) {
			console.error('PDF export failed:', err);
			setPdfExportState('failure');
		});
	}

	function syncPdfAvailability() {
		if (!pdfBtn) return;
		pdfBtn.disabled = !chatDiv.querySelector('#transcript');
	}

	function rowsFromTranscript(container) {
		var rows = [];
		container.querySelectorAll('.message').forEach(function (msg) {
			var messageId = msg.getAttribute('data-message-id') || '';
			var timestamp = msg.getAttribute('data-timestamp') || '';
			var author = msg.getAttribute('data-author') || '';
			var contentText = msg.getAttribute('data-content-text') || '';
			if (!contentText) {
				var section = msg.querySelector('section');
				contentText = section ? section.innerText.trim() : '';
			}
			rows.push({
				messageId: messageId,
				timestamp: timestamp,
				author: author,
				contentText: contentText
			});
		});
		return rows;
	}

	async function startExtraction() {
		var sort = document.querySelector('input[name="sort"]:checked').value;
		if (selectedRangeMode === 'custom' && !validateCustomRange()) {
			return;
		}

		optionsDiv.style.display = 'none';
		statusDiv.style.display = 'block';
		chatDiv.style.display = 'none';
		toolbarDiv.style.display = 'none';
		extractedRows = [];
		csvBtn.disabled = true;
		if (pdfBtn) pdfBtn.disabled = true;
		startBtn.disabled = true;
		if (viewResultsBtn) viewResultsBtn.style.display = 'none';

		if (selectedRangeMode === 'custom') {
			progressText.textContent = 'Extracting messages from ' + startDateInput.value + ' to ' + endDateInput.value + '\u2026';
		} else if (selectedQuickDays < 0) {
			progressText.textContent = 'Extracting loaded messages\u2026';
		} else if (selectedQuickDays === 0) {
			progressText.textContent = 'Scrolling to load all messages\u2026';
		} else {
			progressText.textContent = 'Scrolling to load last ' + selectedQuickDays + ' days\u2026';
		}

		// Show the Stop button while extracting
		var stopBtn = document.getElementById('stop-extraction-btn');
		if (stopBtn) {
			stopBtn.style.display = 'inline-block';
			stopBtn.disabled = false;
		}


		var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		var tab = tabs[0];
		if (!tab) {
			restoreOptions('<p style="color:red;">No active tab found.</p>');
			return;
		}

		activeTabId = tab.id;
		chatTarget.textContent = 'Target chat: ' + parseChatNameFromTitle(tab.title);

		try {
            // Updated to inject selector-config.js before payload.js
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				files: ['selector-config.js', 'payload.js']
			});

			await chrome.tabs.sendMessage(tab.id, {
				action: 'extract',
				rangeMode: selectedRangeMode,
				days: selectedQuickDays,
				startDate: selectedRangeMode === 'custom' ? startDateInput.value : '',
				endDate: selectedRangeMode === 'custom' ? endDateInput.value : '',
				sort: sort
			});
		} catch (err) {
			restoreOptions('<p style="color:red;">Could not extract chat. Make sure you are on a Microsoft Teams chat page (teams.microsoft.com).</p>');
			console.error('Extraction error:', err);
		}
	}

	copyBtn.addEventListener('click', function () {
		var transcript = chatDiv.querySelector('#transcript');
		if (!transcript) return;
		navigator.clipboard.writeText(transcript.innerText).then(function () {
			showToast('Copied!');
		});
	});

	mdBtn.addEventListener('click', function () {
		var transcript = chatDiv.querySelector('#transcript');
		if (!transcript) return;
		downloadBlob(htmlToMarkdown(transcript, currentResultMeta), 'text/markdown', 'md', null, currentResultMeta);
		showToast('Downloaded!');
	});

	csvBtn.addEventListener('click', function () {
		if (extractedRows.length === 0) return;
		downloadBlob(rowsToCsv(extractedRows, currentResultMeta), 'text/csv;charset=utf-8', 'csv', { withUtf8Bom: true }, currentResultMeta);
		showToast('Downloaded!');
	});

	if (pdfBtn) {
		pdfBtn.addEventListener('click', function () {
			exportTranscriptAsPdf();
		});
	}

	if (backBtn) {
		backBtn.addEventListener('click', function () {
			showOptionsFromResults();
		});
	}

	if (imageOnlyBtn) {
		imageOnlyBtn.addEventListener('click', function () {
			setImageOnlyMode(!imageOnlyMode);
		});
	}

	if (viewResultsBtn) {
		viewResultsBtn.addEventListener('click', function () {
			// Load stored result from service worker and render it
			fetchStoredResult().then(function (payload) {
				if (!payload) {
					showToast('No stored extraction available.');
					return;
				}
				var imageIds = Array.isArray(payload.imageIds) ? payload.imageIds : [];
				fetchStoredImages(imageIds).then(function (map) {
					renderCurrentResults(payload, map);
				}).catch(function (err) {
					console.error('Failed to load stored images:', err);
					renderCurrentResults(payload, {});
				});
			}).catch(function (err) {
				console.error('Failed to load stored result:', err);
				showToast('Failed to load stored result');
			});
		});
	}

	function fetchStoredResult() {
		return new Promise(function (resolve, reject) {
			chrome.runtime.sendMessage({ type: 'get-last-run' }, function (response) {
				if (!response) return resolve(null);
				if (response.status === 'error') return reject(new Error(response.error || 'unknown'));
				resolve(response.lastCompleted || null);
			});
		});
	}

	function fetchStoredImages(imageIds) {
		return new Promise(function (resolve, reject) {
			if (!imageIds || imageIds.length === 0) return resolve({});
			chrome.runtime.sendMessage({ type: 'get-images', imageIds: imageIds }, function (response) {
				if (!response) return resolve({});
				if (response.status === 'error') return reject(new Error(response.error || 'unknown'));
				var map = {};
				(response.images || []).forEach(function (img) {
					try {
						var blob = img.blob;
						if (!blob && img.buffer) {
							blob = new Blob([img.buffer], { type: img.contentType || 'image/png' });
						}
						if (blob) {
							var url = URL.createObjectURL(blob);
							map[img.imageId] = { url: url, blob: blob, contentType: img.contentType };
							return;
						}
						if (img.sourceUrl && !isBlobUrl(img.sourceUrl)) {
							map[img.imageId] = { url: img.sourceUrl, contentType: img.contentType };
						}
					} catch (e) {
						console.error('Failed to create object URL for image', img.imageId, e);
					}
				});
				resolve(map);
			});
		});
	}

	var TRANSPARENT_PIXEL_DATA_URI = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

	function isBlobUrl(url) {
		return typeof url === 'string' && /^blob:/i.test(url);
	}

	function blobToDataUrl(blob) {
		if (!blob) return Promise.resolve('');
		return new Promise(function (resolve, reject) {
			var reader = new FileReader();
			reader.onload = function () {
				resolve(String(reader.result || ''));
			};
			reader.onerror = function () {
				reject(reader.error || new Error('Unable to read image blob.'));
			};
			reader.readAsDataURL(blob);
		});
	}

	function sanitizeImageHtml(html) {
		var wrapper = document.createElement('div');
		wrapper.innerHTML = String(html || '');
		Array.from(wrapper.querySelectorAll('img')).forEach(function (imgEl) {
			if (isBlobUrl(imgEl.getAttribute('src'))) {
				imgEl.setAttribute('src', TRANSPARENT_PIXEL_DATA_URI);
			}
		});
		return wrapper.innerHTML;
	}

	function renderStoredResult(payload, imageMap) {
		var renderMeta = buildResultMetaFromPayload(payload);
		currentResultMeta = renderMeta;
		optionsDiv.style.display = 'none';
		statusDiv.style.display = 'none';
		toolbarDiv.style.display = 'flex';
		chatDiv.style.display = 'block';
		chatDiv.innerHTML = buildRenderedResultsHtml(payload, renderMeta);
		var transcript = chatDiv.querySelector('#transcript');
		extractedRows = Array.isArray(payload.rows) ? payload.rows : rowsFromTranscript(transcript);
		syncPdfAvailability();
		if (payload.count) {
			titleEl.textContent = 'Chat Transcript (' + payload.count + ' messages)';
		}
		startBtn.disabled = false;
		rehydrateImages(transcript, imageMap);
		updateExportAvailability();
		syncLoadedSessionUi();

	}

	function renderImageOnlyResult(payload, imageMap) {
		renderStoredResult(payload, imageMap);
		var transcript = chatDiv.querySelector('#transcript');
		if (!transcript) return;

		var imageNodes = Array.from(transcript.querySelectorAll('img'));
		var gallery = document.createElement('div');
		gallery.className = 'image-only-gallery';

		imageNodes.forEach(function (imgEl) {
			var wrapper = document.createElement('div');
			wrapper.className = 'image-only-item';
			wrapper.appendChild(imgEl.cloneNode(true));
			gallery.appendChild(wrapper);
		});

		if (imageNodes.length === 0) {
			transcript.innerHTML = '<div class="image-only-empty">No images in this transcript.</div>';
		} else {
			transcript.innerHTML = '';
			transcript.appendChild(gallery);
		}

		updateExportAvailability();
	}

	function renderCurrentResults(payload, imageMap) {
		currentResultPayload = payload;
		currentResultImageMap = imageMap || {};
		imageOnlyMode = false;
		updateResultsModeButton();
		applyCurrentResultsView();
	}

	quickButtons.forEach(function (btn) {
		btn.addEventListener('click', function () {
			selectedRangeMode = 'quick';
			selectedQuickDays = parseInt(btn.dataset.days, 10);
			selectedQuickLabel = btn.dataset.label || btn.textContent.trim();
			setSelectedQuickButton(btn);
			document.querySelector('.custom-range').classList.remove('selected');
			setRangeError('');
			renderSelectionSummary();
		});
	});

	function onCustomInputChanged() {
		selectedRangeMode = 'custom';
		quickButtons.forEach(function (b) { b.classList.remove('selected'); });
		document.querySelector('.custom-range').classList.add('selected');
		validateCustomRange();
		renderSelectionSummary();
	}

	startDateInput.addEventListener('change', onCustomInputChanged);
	endDateInput.addEventListener('change', onCustomInputChanged);

	startBtn.addEventListener('click', function () {
		startExtraction();
	});

	var stopExtractionBtn = document.getElementById('stop-extraction-btn');
	if (stopExtractionBtn) {
		stopExtractionBtn.addEventListener('click', function () {
			if (!activeTabId) return;
			progressText.textContent = 'Pausing...';
			stopExtractionBtn.disabled = true;
			chrome.tabs.sendMessage(activeTabId, { type: 'STOP_EXTRACTION' }, function (response) {
				// No-op; content script will post EXTRACTION_PAUSED message via chrome.runtime.sendMessage
			});

			// Fallback: if no response within 10s, show error and re-enable button
			setTimeout(function () {
				if (stopExtractionBtn && stopExtractionBtn.disabled) {
					stopExtractionBtn.disabled = false;
					progressText.textContent = 'Timed out waiting for pause response.';
				}
			}, 10000);
		});
	}

	chrome.runtime.onMessage.addListener(function (message, sender) {
		if (!sender.tab || sender.tab.id !== activeTabId) return;

		if (message.type === 'progress') {
			extractedRows = [];
			csvBtn.disabled = true;
			if (pdfBtn) pdfBtn.disabled = true;
			progressText.textContent = message.count + ' messages collected so far\u2026';

		} else if (message.type === 'EXTRACTION_PAUSED') {
			// Pause response: render partial results with a banner
			var stopBtnEl = document.getElementById('stop-extraction-btn');
			if (stopBtnEl) stopBtnEl.style.display = 'none';
			statusDiv.style.display = 'none';
			toolbarDiv.style.display = 'flex';
			chatDiv.style.display = 'block';
			var selectorDiagHtml = renderSelectorDiagnostics(message.selectorDiagnostics);


			var partialBanner = '<div class="partial-banner">Partial results &mdash; extraction paused by user.</div>';
			chatDiv.innerHTML = selectorDiagHtml + partialBanner + '<div id="transcript">' + (message.html || '<p>No messages found.</p>') + '</div>';
			var transcriptEl = chatDiv.querySelector('#transcript');
			extractedRows = Array.isArray(message.rows) ? message.rows : rowsFromTranscript(transcriptEl);
			csvBtn.disabled = extractedRows.length === 0;
			syncPdfAvailability();
			if (message.count) {
				titleEl.textContent = 'Chat Transcript (' + message.count + ' messages)';
			}
			startBtn.disabled = false;
			syncLoadedSessionUi();

		} else if (message.type === 'result') {
			var stopBtnEl = document.getElementById('stop-extraction-btn');
			if (stopBtnEl) stopBtnEl.style.display = 'none';
			var liveImageIds = Array.isArray(message.imageIds) ? message.imageIds : [];
			fetchStoredImages(liveImageIds).then(function (map) {
				renderCurrentResults(message, map);
			}).catch(function (err) {
				console.error('Failed to load live extraction images:', err);
				renderCurrentResults(message, {});
			});
			startBtn.disabled = false;

		} else if (message.type === 'error') {
			var stopBtnEl = document.getElementById('stop-extraction-btn');
			if (stopBtnEl) stopBtnEl.style.display = 'none';
			extractedRows = [];
			csvBtn.disabled = true;
			if (pdfBtn) pdfBtn.disabled = true;
			restoreOptions('<p style="color:red;">' + message.error + '</p>');
		}
	});

	(function init() {
		var today = todayDateString();
		startDateInput.max = today;
		endDateInput.max = today;
		startDateInput.value = today;
		endDateInput.value = today;
		renderSelectionSummary();
		syncLoadedSessionUi();
		if (pdfBtn) {
			pdfBtn.disabled = true;
		}

		chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
			var tab = tabs[0];
			if (tab && tab.id) {
				activeTabId = tab.id;
				chatTarget.textContent = 'Target chat: ' + parseChatNameFromTitle(tab.title);
			}
		}).catch(function () {
			chatTarget.textContent = 'Target chat: Current Teams chat';
		});

		// Query service worker for last completed meta to update UI
		chrome.runtime.sendMessage({ type: 'get-last-run' }, function (response) {
			try {
				if (response && response.lastCompletedMeta) {
					hasStoredPayload = true;
				}
			} catch (e) { /* ignore */ }
			syncLoadedSessionUi();
		});

		updateResultsModeButton();
		updateExportAvailability();
	})();
});
