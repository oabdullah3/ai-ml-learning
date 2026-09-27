/* global chrome */

const DB_NAME = 'teams-chat-extractor';
const DB_VERSION = 1;
const RESULTS_STORE = 'results';
const IMAGES_STORE = 'images';
const LAST_KEY = 'last';

function openDb() {
	return new Promise(function (resolve, reject) {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = function (event) {
			const db = event.target.result;
			if (!db.objectStoreNames.contains(RESULTS_STORE)) {
				db.createObjectStore(RESULTS_STORE);
			}
			if (!db.objectStoreNames.contains(IMAGES_STORE)) {
				const store = db.createObjectStore(IMAGES_STORE, { keyPath: 'imageId' });
				store.createIndex('runId', 'runId', { unique: false });
			}
		};
		request.onsuccess = function () { resolve(request.result); };
		request.onerror = function () { reject(request.error); };
	});
}

function withStore(storeName, mode, fn) {
	return openDb().then(function (db) {
		return new Promise(function (resolve, reject) {
			const tx = db.transaction(storeName, mode);
			const store = tx.objectStore(storeName);
			const result = fn(store, tx);
			tx.oncomplete = function () { resolve(result); };
			tx.onerror = function () { reject(tx.error); };
			tx.onabort = function () { reject(tx.error); };
		});
	});
}

function putResult(payload) {
	return withStore(RESULTS_STORE, 'readwrite', function (store) {
		store.put(payload, LAST_KEY);
	});
}

function putImage(image) {
	return withStore(IMAGES_STORE, 'readwrite', function (store) {
		store.put(image);
	});
}

function getLastResult() {
	return withStore(RESULTS_STORE, 'readonly', function (store) {
		return new Promise(function (resolve, reject) {
			const request = store.get(LAST_KEY);
			request.onsuccess = function () { resolve(request.result || null); };
			request.onerror = function () { reject(request.error); };
		});
	});
}

function getImagesByIds(imageIds) {
	return withStore(IMAGES_STORE, 'readonly', function (store) {
		return Promise.all(imageIds.map(function (imageId) {
			return new Promise(function (resolve, reject) {
				const request = store.get(imageId);
				request.onsuccess = function () { resolve(request.result || null); };
				request.onerror = function () { reject(request.error); };
			});
		}));
	});
}

function deleteImagesByRunId(runId) {
	return withStore(IMAGES_STORE, 'readwrite', function (store) {
		return new Promise(function (resolve, reject) {
			const index = store.index('runId');
			const request = index.openCursor(IDBKeyRange.only(runId));
			request.onsuccess = function (event) {
				const cursor = event.target.result;
				if (!cursor) {
					resolve();
					return;
				}
				store.delete(cursor.primaryKey);
				cursor.continue();
			};
			request.onerror = function () { reject(request.error); };
		});
	});
}

function setActiveRun(activeRun) {
	return chrome.storage.local.set({ activeRun: activeRun });
}

function clearActiveRun() {
	return chrome.storage.local.remove('activeRun');
}

function setLastCompletedMeta(meta) {
	return chrome.storage.local.set({ lastCompletedMeta: meta });
}

function clearLastCompletedMeta() {
	return chrome.storage.local.remove('lastCompletedMeta');
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
	if (!message || !message.type) return;

	if (message.type === 'extract-progress') {
		const activeRun = {
			runId: message.runId,
			status: 'in-progress',
			count: message.count || 0,
			tabId: message.tabId,
			startTs: message.startTs || new Date().toISOString()
		};
		setActiveRun(activeRun).then(function () {
			chrome.runtime.sendMessage(message).catch(function () {});
			sendResponse({ status: 'ok' });
		}).catch(function (err) {
			sendResponse({ status: 'error', error: String(err) });
		});
		return true;
	}

	if (message.type === 'extract-image') {
		var imageBlob = null;
		if (message.blobBuffer) {
			imageBlob = new Blob([message.blobBuffer], { type: message.contentType || 'application/octet-stream' });
		}
		putImage({
			imageId: message.imageId,
			runId: message.runId,
			contentType: message.contentType || '',
			sourceUrl: message.sourceUrl || '',
			blob: imageBlob || message.blob || null
		}).then(function () {
			sendResponse({ status: 'ok' });
		}).catch(function (err) {
			sendResponse({ status: 'error', error: String(err) });
		});
		return true;
	}

	if (message.type === 'extract-result') {
		const payload = {
			runId: message.runId,
			status: 'completed',
			startTs: message.startTs || message.ts || new Date().toISOString(),
			endTs: message.ts || new Date().toISOString(),
			count: message.count || 0,
			html: message.html || '',
			rows: message.rows || [],
			chatName: message.chatName || '',
			rangeMeta: message.rangeMeta || {},
			selectorDiagnostics: message.selectorDiagnostics || {},
			imageIds: message.imageIds || []
		};
		getLastResult().then(function (existing) {
			const oldRunId = existing ? existing.runId : null;
			return putResult(payload).then(function () {
				return setLastCompletedMeta({
					runId: payload.runId,
					count: payload.count,
					startTs: payload.startTs,
					endTs: payload.endTs,
					imageCount: payload.imageIds.length
				});
			}).then(function () {
				return clearActiveRun();
			}).then(function () {
				if (oldRunId && oldRunId !== payload.runId) {
					return deleteImagesByRunId(oldRunId);
				}
			}).then(function () {
				chrome.runtime.sendMessage(message).catch(function () {});
				sendResponse({ status: 'ok' });
			});
		}).catch(function (err) {
			sendResponse({ status: 'error', error: String(err) });
		});
		return true;
	}

	if (message.type === 'extract-error' || message.type === 'extract-cancelled') {
		clearActiveRun().then(function () {
			chrome.runtime.sendMessage(message).catch(function () {});
			sendResponse({ status: 'ok' });
		}).catch(function (err) {
			sendResponse({ status: 'error', error: String(err) });
		});
		return true;
	}

	if (message.type === 'get-last-run') {
		Promise.all([
			chrome.storage.local.get(['activeRun', 'lastCompletedMeta']),
			getLastResult()
		]).then(function (results) {
			const meta = results[0];
			const payload = results[1];
			sendResponse({
				activeRun: meta.activeRun || null,
				lastCompletedMeta: meta.lastCompletedMeta || null,
				lastCompleted: payload || null
			});
		}).catch(function (err) {
			sendResponse({ status: 'error', error: String(err) });
		});
		return true;
	}

	if (message.type === 'get-images') {
		getImagesByIds(message.imageIds || []).then(function (images) {
			var filtered = images.filter(Boolean);
			return Promise.all(filtered.map(function (img) {
				if (!img) {
					return img;
				}
				if (!img.blob || typeof img.blob.arrayBuffer !== 'function') {
					return {
						imageId: img.imageId,
						runId: img.runId,
						contentType: img.contentType || '',
						sourceUrl: img.sourceUrl || ''
					};
				}
				return img.blob.arrayBuffer().then(function (buffer) {
					return {
						imageId: img.imageId,
						runId: img.runId,
						contentType: img.contentType || img.blob.type || 'application/octet-stream',
						sourceUrl: img.sourceUrl || '',
						buffer: buffer
					};
				});
			}));
		}).then(function (serialized) {
			sendResponse({ status: 'ok', images: serialized });
		}).catch(function (err) {
			sendResponse({ status: 'error', error: String(err) });
		});
		return true;
	}

	if (message.type === 'fetch-image-for-pdf') {
		fetch(message.url, { credentials: 'include' }).then(function (response) {
			if (!response || !response.ok) {
				throw new Error('Failed to fetch image for PDF: ' + (response ? response.status : 'no-response'));
			}
			return response.blob();
		}).then(function (blob) {
			if (!blob || !blob.size) {
				throw new Error('Fetched image blob is empty.');
			}
			return blob.arrayBuffer().then(function (buffer) {
				sendResponse({
					status: 'ok',
					buffer: buffer,
					contentType: blob.type || 'application/octet-stream'
				});
			});
		}).catch(function (err) {
			sendResponse({ status: 'error', error: String(err) });
		});
		return true;
	}

	if (message.type === 'cancel-run') {
		const runId = message.runId;
		chrome.storage.local.set({ cancellationRequested: runId }).then(function () {
			return chrome.tabs.sendMessage(message.tabId, { type: 'cancel', runId: runId });
		}).then(function () {
			sendResponse({ status: 'ok' });
		}).catch(function (err) {
			sendResponse({ status: 'error', error: String(err) });
		});
		return true;
	}

	if (message.type === 'clear-last-result') {
		getLastResult().then(function (existing) {
			const runId = existing ? existing.runId : null;
			return withStore(RESULTS_STORE, 'readwrite', function (store) {
				store.delete(LAST_KEY);
			}).then(function () {
				if (runId) return deleteImagesByRunId(runId);
			}).then(function () {
				return clearLastCompletedMeta();
			});
		}).then(function () {
			sendResponse({ status: 'ok' });
		}).catch(function (err) {
			sendResponse({ status: 'error', error: String(err) });
		});
		return true;
	}
});
