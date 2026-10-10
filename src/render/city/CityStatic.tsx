import { memo } from 'react'
import type { CityMap } from '../../sim/types'
import { Buildings } from './Buildings'
import { Ground } from './Ground'
import { Mrt } from './Mrt'
import { Props } from './Props'

/** 城市中不會動的部分；city 不變就不重繪 */
export const CityStatic = memo(function CityStatic({ city }: { city: CityMap }) {
  return (
    <group>
      <Ground city={city} />
      <Buildings buildings={city.buildings} />
      <Props props={city.props} />
      <Mrt city={city} />
    </group>
  )
})
