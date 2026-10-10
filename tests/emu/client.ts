import { readFileSync } from 'node:fs'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth'
import { connectDatabaseEmulator, getDatabase, type Database } from 'firebase/database'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { AUTH_EMULATOR_URL, DATABASE_EMULATOR, EMULATOR_DATABASE_URL, EMULATOR_PROJECT_ID } from '../../src/net/emulator'
import { createRoomRepository, type RoomRepository } from '../../src/net/rooms'

export interface TestClient {
  uid: string
  db: Database
  rooms: RoomRepository
}

const apps: FirebaseApp[] = []
let appCount = 0

/** 新的匿名使用者，連到 App 使用的同一個資料庫 */
export async function newClient(): Promise<TestClient> {
  const app = initializeApp({ projectId: EMULATOR_PROJECT_ID, apiKey: 'demo-api-key', databaseURL: EMULATOR_DATABASE_URL }, `client-${++appCount}`)
  apps.push(app)
  const auth = getAuth(app)
  connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true })
  const db = getDatabase(app)
  connectDatabaseEmulator(db, DATABASE_EMULATOR.host, DATABASE_EMULATOR.port)
  const { user } = await signInAnonymously(auth)
  return { uid: user.uid, db, rooms: createRoomRepository(db) }
}

export async function closeClients(): Promise<void> {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app)))
}

/** 規則測試用的環境；它使用以專案 id 命名的資料庫，載入 database.rules.json */
export function rulesEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    database: {
      host: DATABASE_EMULATOR.host,
      port: DATABASE_EMULATOR.port,
      rules: readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8'),
    },
  })
}

/** 清掉 App 使用的資料庫裡本遊戲的資料 */
export function clearAppDatabase(env: RulesTestEnvironment): Promise<void> {
  const url = `http://${DATABASE_EMULATOR.host}:${DATABASE_EMULATOR.port}/?ns=${EMULATOR_PROJECT_ID}-default-rtdb`
  return env.withSecurityRulesDisabled((ctx) => ctx.database(url).ref('taipeiBike').remove())
}
