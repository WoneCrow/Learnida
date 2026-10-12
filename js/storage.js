/**
 * storage.js
 * Couche unique d'accès à IndexedDB. Aucun autre module ne doit ouvrir
 * de transaction directement : tout passe par les fonctions exportées ici.
 *
 * Stores :
 *  - profile          (keyPath: "key")   -> doc unique "profile" (xp, niveau, totaux, série quotidienne, reprise)
 *  - settings         (keyPath: "key")   -> doc unique "settings" (préférences)
 *  - questionStats    (keyPath: "id")    -> une entrée par question rencontrée
 *  - sequenceProgress (keyPath: "sequenceId") -> une entrée par séquence
 *  - notes            (keyPath: "id", autoIncrement)
 *  - milestones       (keyPath: "id")    -> jalons permanents débloqués (streak, niveau, maîtrise...)
 */

const DB_NAME = 'learnida-db';
const DB_VERSION = 2;

let dbPromise = null;
let idbAvailable = true;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      idbAvailable = false;
      reject(new Error('IndexedDB indisponible sur ce navigateur.'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('questionStats')) {
        db.createObjectStore('questionStats', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sequenceProgress')) {
        db.createObjectStore('sequenceProgress', { keyPath: 'sequenceId' });
      }
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('milestones')) {
        db.createObjectStore('milestones', { keyPath: 'id' });
      }
    };

    req.onsuccess = (event) => {
      idbAvailable = true;
      resolve(event.target.result);
    };

    req.onerror = () => {
      idbAvailable = false;
      reject(req.error || new Error('Impossible d\'ouvrir la base de données locale.'));
    };
  });

  return dbPromise;
}

function isAvailable() {
  return idbAvailable;
}

function tx(db, storeName, mode) {
  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRecord(storeName, key) {
  const db = await openDB();
  const store = tx(db, storeName, 'readonly');
  return reqToPromise(store.get(key));
}

async function putRecord(storeName, value) {
  const db = await openDB();
  const store = tx(db, storeName, 'readwrite');
  return reqToPromise(store.put(value));
}

async function deleteRecord(storeName, key) {
  const db = await openDB();
  const store = tx(db, storeName, 'readwrite');
  return reqToPromise(store.delete(key));
}

async function getAll(storeName) {
  const db = await openDB();
  const store = tx(db, storeName, 'readonly');
  return reqToPromise(store.getAll());
}

async function clearStore(storeName) {
  const db = await openDB();
  const store = tx(db, storeName, 'readwrite');
  return reqToPromise(store.clear());
}

async function clearAll() {
  await Promise.all([
    clearStore('profile'),
    clearStore('questionStats'),
    clearStore('sequenceProgress'),
    clearStore('notes'),
    clearStore('milestones')
    // "settings" volontairement conservé (préférences d'affichage/son)
  ]);
}

const Storage = {
  openDB,
  isAvailable,
  getRecord,
  putRecord,
  deleteRecord,
  getAll,
  clearStore,
  clearAll
};

window.Storage = Storage;
