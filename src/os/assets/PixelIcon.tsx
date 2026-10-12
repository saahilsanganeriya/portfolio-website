import { ICONS, type IconName } from './icons';

export function PixelIcon({ name, size = 32, className }: { name: IconName; size?: number; className?: string }) {
  const { width, height, rects } = ICONS[name];
  return (
    <svg
      className={className}
      width={size}
      height={(size * height) / width}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.width} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}
