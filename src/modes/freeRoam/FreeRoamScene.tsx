import { useEngine, useHud } from '../../game/EngineContext'
import { SIDEWALK_HEIGHT } from '../../render/city/heights'

/** 可拜訪住家的大門標記；拜訪過的變成綠色 */
export function FreeRoamScene() {
  const engine = useEngine()
  // 拜訪數變動時 HUD 會通知，讓標記重新上色
  useHud()
  const visited = new Set(engine.state.save.visited)
  const homes = engine.city.homes
  return (
    <group>
      {homes.map((home) => (
        <mesh key={home.id} position={[home.door.x, SIDEWALK_HEIGHT + 0.02, home.door.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.6, 0.85, 24]} />
          <meshBasicMaterial color={visited.has(home.id) ? '#3fbf6f' : '#ffcc33'} />
        </mesh>
      ))}
    </group>
  )
}
