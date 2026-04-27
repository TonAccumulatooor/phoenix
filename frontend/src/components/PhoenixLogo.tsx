export function PhoenixLogo({
  className = 'w-10 h-10',
  rising = false,
}: {
  className?: string;
  rising?: boolean;
}) {
  return (
    <img
      src="/phoenix-logo-transparentbg.png"
      alt="Phoenix"
      className={`${className} object-contain select-none${rising ? ' hero-phoenix-float' : ''}`}
      draggable={false}
    />
  );
}
