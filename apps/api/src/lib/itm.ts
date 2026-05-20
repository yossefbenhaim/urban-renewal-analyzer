// WGS84 (EPSG:4326) ↔ Israeli Transverse Mercator (EPSG:2039) conversion.
//
// GovMap and MAVAT both publish coordinates in ITM. The frontend, however,
// needs WGS84 lat/lon for Google Maps / Street View links. proj4 + the
// official EPSG:2039 definition handle the conversion both ways.

import proj4 from 'proj4'

// Official EPSG:2039 definition (Israel TM Grid) — copied verbatim from
// https://epsg.io/2039.proj4
const ITM_DEF =
  '+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 ' +
  '+x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-48,55,52,0,0,0,0 +units=m +no_defs'

proj4.defs('EPSG:2039', ITM_DEF)

export function itmToWgs84(x: number, y: number): { lat: number; lon: number } {
  const [lon, lat] = proj4('EPSG:2039', 'WGS84', [x, y])
  return { lat, lon }
}

export function wgs84ToItm(lat: number, lon: number): { x: number; y: number } {
  const [x, y] = proj4('WGS84', 'EPSG:2039', [lon, lat])
  return { x, y }
}
