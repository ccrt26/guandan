import { useEffect } from 'react';

const TIERS: (0 | 1 | 2)[] = [0, 1, 2];
const SRC = (t: 0 | 1 | 2) => `/preview/wide_${['beginner', 'intermediate', 'advanced'][t]}.jpg`;

/** 训练预览：全幅绿色场景层（Blender 按实测容器 1694×852 渲染，连续台呢+六牌+真实阴影一体）。
 * 切档 = 预加载资源即时切换；标题/副标题/标签为独立 DOM 覆盖其上。 */
export function PreviewBackdrop({ tier }: { tier: 0 | 1 | 2 }) {
  useEffect(() => { TIERS.forEach((t) => { const im = new Image(); im.src = SRC(t); }); }, []);
  return (
    <div className="tz-scene" aria-hidden>
      {TIERS.map((t) => (
        <img key={t} src={SRC(t)} alt="" draggable={false} className={`tz-scene-img${t === tier ? ' on' : ''}`} />
      ))}
    </div>
  );
}
