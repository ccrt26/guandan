/** DOT 1800×874 design units. Layout is recomputed from the real viewport;
 * no fixed canvas, browser zoom, or physical screenshot pixels are involved. */
export interface Rect { x: number; y: number; width: number; height: number }
export type TableSeat = 'north' | 'west' | 'east' | 'self';
export interface TableLayout {
  scale: number;
  compact: number;
  width: number;
  headerHeight: number;
  footerHeight: number;
  tableHeight: number;
  hand: Rect & { cardWidth: number; step: number };
  selfLabel: Rect;
  panel: Rect;
  players: Record<'north' | 'west' | 'east', Rect>;
  zones: Record<TableSeat, Rect>;
}

export function getTableLayout(width: number, height: number, tribute: boolean, count: number, selected = false): TableLayout {
  // Enlarge a spacious desktop proportionately; compact windows keep readable
  // card faces and text, and spend less space between/overlapping components.
  const scale = Math.max(1, Math.min(width / 1800, height / 874));
  const w = width / scale;
  const tableH = height / scale - 66 - 85;
  const compact = Math.min(1, Math.max(0, (723 - tableH) / 106));
  const rect = (x:number,y:number,width:number,height:number): Rect =>
    ({x:x*scale,y:y*scale,width:width*scale,height:height*scale});
  const cardH = tribute ? 175 : 189;
  const cardW = tribute ? 175 * 630 / 880 : 135;
  const available = Math.min(1570, w - 2 * Math.min(115, w * 115 / 1800));
  const n = Math.max(0, Math.floor(count));
  const step = n > 1 ? Math.min((1570-cardW)/26, (available-cardW)/(n-1)) : 0;
  const rowW = n ? cardW + (n-1)*step : 0;
  const handY = tableH - (tribute ? 16 : 14) - cardH;
  const labelH = tribute ? 54-10*compact : 60;
  const labelY = handY-labelH-(tribute ? 0 : 11);
  const westLeft = Math.max(29+(212-32*compact)+20,261*w/1800);
  const eastRight = Math.max(224,224*w/1800);
  const sideY = 218+(tableH-723)*0.5;
  const selfY = labelY-16-112;
  return {
    scale, compact, width, headerHeight:66*scale, footerHeight:85*scale, tableHeight:tableH*scale,
    hand:{...rect((w-rowW)/2,handY,rowW,cardH),cardWidth:cardW*scale,step:step*scale},
    selfLabel:rect((w-(tribute?244:266))/2,labelY-(!tribute && selected?8:0),tribute?244:266,labelH),
    panel:rect((w-745)/2,101-23*compact,745,372-84*compact),
    players:{
      north:rect((w-200)/2,26-(tribute?16*compact:0),200,60-(tribute?6*compact:0)),
      west:rect(29,sideY+8,212-32*compact,65),
      east:rect(w-25-180,sideY+9,180,65),
    },
    zones:{
      north:rect((w-420)/2,98,420,112),
      self:rect((w-402)/2,selfY,402,112),
      west:rect(westLeft,sideY,Math.min(400,(w-402)/2-20-westLeft),112),
      east:rect(w/2+201+20,sideY,Math.min(460,(w-402)/2-20-eastRight),112),
    },
  };
}

export function getPlayedLayout(seat: TableSeat, count: number, table: TableLayout): Rect & { cardWidth:number; step:number } {
  const zone = table.zones[seat];
  const cardWidth = 80*table.scale;
  const steps:Record<TableSeat,number>={north:205/3,west:179/3,east:261/5,self:322/6};
  const n=Math.max(0,Math.floor(count));
  const step=n>1?Math.max(0,Math.min(steps[seat]*table.scale,(zone.width-cardWidth)/(n-1))):0;
  const width=n?cardWidth+(n-1)*step:0;
  const x=seat==='west'?zone.x:seat==='east'?table.width-Math.max(224*table.scale,224*table.width/1800)-width:(table.width-width)/2;
  return {x,y:zone.y,width,height:112*table.scale,cardWidth,step};
}
