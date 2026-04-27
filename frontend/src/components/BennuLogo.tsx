export function BennuLogo({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bennu-grad" x1="50" y1="0" x2="50" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f19434" />
          <stop offset="50%" stopColor="#ee7a11" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
        <linearGradient id="bennu-wing" x1="20" y1="30" x2="80" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#df6008" />
        </linearGradient>
      </defs>
      {/* Body */}
      <path
        d="M50 8 C52 8, 56 12, 56 18 L56 22 C62 20, 70 22, 76 28 C82 34, 84 42, 80 48 L78 50 C82 54, 84 60, 82 66 C80 72, 74 76, 68 76 L62 75 C60 80, 56 84, 50 86 C44 84, 40 80, 38 75 L32 76 C26 76, 20 72, 18 66 C16 60, 18 54, 22 50 L20 48 C16 42, 18 34, 24 28 C30 22, 38 20, 44 22 L44 18 C44 12, 48 8, 50 8Z"
        fill="url(#bennu-grad)"
        opacity="0.9"
      />
      {/* Left wing */}
      <path
        d="M38 40 C30 36, 18 34, 8 38 C14 42, 22 44, 30 44 C22 48, 14 54, 10 62 C18 58, 28 52, 36 50Z"
        fill="url(#bennu-wing)"
        opacity="0.8"
      />
      {/* Right wing */}
      <path
        d="M62 40 C70 36, 82 34, 92 38 C86 42, 78 44, 70 44 C78 48, 86 54, 90 62 C82 58, 72 52, 64 50Z"
        fill="url(#bennu-wing)"
        opacity="0.8"
      />
      {/* Head crest (two feathers like the Bennu) */}
      <path
        d="M46 18 C44 10, 40 4, 38 2 C40 6, 42 12, 44 18"
        stroke="#fbbf24"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M54 18 C56 10, 60 4, 62 2 C60 6, 58 12, 56 18"
        stroke="#fbbf24"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      {/* Eye */}
      <circle cx="50" cy="32" r="3" fill="#0d0d12" />
      <circle cx="51" cy="31" r="1" fill="#fbbf24" />
      {/* Tail flames */}
      <path
        d="M44 86 C42 90, 38 94, 36 98 C40 96, 44 92, 46 88"
        fill="#ef4444"
        opacity="0.7"
      />
      <path
        d="M50 86 C50 91, 50 95, 50 100 C52 96, 52 92, 52 88"
        fill="#fbbf24"
        opacity="0.6"
      />
      <path
        d="M56 86 C58 90, 62 94, 64 98 C60 96, 56 92, 54 88"
        fill="#ef4444"
        opacity="0.7"
      />
    </svg>
  );
}
