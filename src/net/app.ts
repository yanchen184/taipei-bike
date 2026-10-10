import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, inMemoryPersistence, type Auth, initializeAuth, signInAnonymously } from 'firebase/auth'
import { connectDatabaseEmulator, getDatabase } from 'firebase/database'
import type { RoomLink } from '../game/online'
import { AUTH_EMULATOR_URL, DATABASE_EMULATOR, EMULATOR_DATABASE_URL, EMULATOR_PROJECT_ID } from './emulator'
import { createRoomRepository, type RoomRepository } from './rooms'

const useEmulator = import.meta.env.VITE_USE_EMULATOR === 'true'

function readConfig(): FirebaseOptions {
  if (useEmulator) return { projectId: EMULATOR_PROJECT_ID, apiKey: 'demo-api-key', databaseURL: EMULATOR_DATABASE_URL }
  const env = import.meta.env
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
    databaseURL: env.VITE_FIREBASE_DATABASE_URL,
  }
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length > 0) throw new Error(`Firebase 設定缺少：${missing.join(', ')}（請設定 VITE_FIREBASE_* 環境變數）`)
  return config
}

interface Services {
  auth: Auth
  rooms: RoomRepository
}

let services: Services | null = null

/** 登入狀態只存在記憶體，每個分頁是一位獨立的匿名玩家 */
function getServices(): Services {
  if (services) return services
  const app = initializeApp(readConfig())
  const auth = initializeAuth(app, { persistence: inMemoryPersistence })
  const db = getDatabase(app)
  if (useEmulator) {
    connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true })
    connectDatabaseEmulator(db, DATABASE_EMULATOR.host, DATABASE_EMULATOR.port)
  }
  services = { auth, rooms: createRoomRepository(db) }
  return services
}

/** code 為 null 時建立新房間，否則加入該房間 */
export async function openRoom(name: string, code: string | null): Promise<RoomLink> {
  const { auth, rooms } = getServices()
  const user = auth.currentUser ?? (await signInAnonymously(auth)).user
  return code === null ? rooms.createRoom(user.uid, name) : rooms.joinRoom(code, user.uid, name)
}
