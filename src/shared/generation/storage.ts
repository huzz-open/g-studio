let database: Promise<IDBDatabase> | undefined
export function generationDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open('g-studio-generation-jobs-v1', 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('jobs')) request.result.createObjectStore('jobs', { keyPath:'localId' })
      if (!request.result.objectStoreNames.contains('models')) request.result.createObjectStore('models', { keyPath:'modelId' })
    }
    request.onsuccess = () => { if(blocked){request.result.close();return} request.result.onversionchange=()=>{request.result.close();database=undefined}; resolve(request.result) }
    request.onerror = () => { database = undefined; reject(request.error) }
    request.onblocked = () => { blocked=true; database=undefined; reject(Error('Close other G-Studio tabs and refresh to update model storage')) }
  })
}
