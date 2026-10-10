import firebaseJson from '../../firebase.json'

export const EMULATOR_PROJECT_ID = 'demo-taipei-bike'
/** Emulator 把 firebase.json 的規則載入 `<專案>-default-rtdb` 這個資料庫 */
export const EMULATOR_DATABASE_URL = `https://${EMULATOR_PROJECT_ID}-default-rtdb.firebaseio.com`
export const AUTH_EMULATOR_URL = `http://${firebaseJson.emulators.auth.host}:${firebaseJson.emulators.auth.port}`
export const DATABASE_EMULATOR = firebaseJson.emulators.database
