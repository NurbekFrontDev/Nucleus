type FlagProps = {
  className?: string
}

export function FlagRu({ className = 'h-3.5 w-5' }: FlagProps) {
  return (
    <svg
      viewBox="0 0 640 480"
      className={`shrink-0 rounded-[2px] border border-black/10 dark:border-white/15 overflow-hidden shadow-xs ${className}`}
      aria-hidden="true"
    >
      <rect width="640" height="160" fill="#FFFFFF" />
      <rect y="160" width="640" height="160" fill="#0039A6" />
      <rect y="320" width="640" height="160" fill="#D52B1E" />
    </svg>
  )
}

export function FlagUs({ className = 'h-3.5 w-5' }: FlagProps) {
  return (
    <svg
      viewBox="0 0 640 480"
      className={`shrink-0 rounded-[2px] border border-black/10 dark:border-white/15 overflow-hidden shadow-xs ${className}`}
      aria-hidden="true"
    >
      <defs>
        <g id="us-star">
          <polygon
            points="0,-6.5 2.01,-2.01 6.84,-2.01 2.93,0.83 4.43,5.6 0,2.79 -4.43,5.6 -2.93,0.83 -6.84,-2.01 -2.01,-2.01"
            fill="#FFFFFF"
          />
        </g>
      </defs>
      {/* 13 stripes: alternating red and white */}
      <rect width="640" height="480" fill="#FFFFFF" />
      <path
        fill="#B22234"
        d="M0 0h640v36.92H0zm0 73.85h640v36.92H0zm0 73.85h640v36.92H0zm0 73.85h640v36.92H0zm0 73.85h640v36.92H0zm0 73.85h640v36.92H0zm0 73.85h640v36.92H0z"
      />
      {/* Canton */}
      <rect width="260" height="258.46" fill="#3C3B6E" />
      {/* Stars pattern in canton */}
      <g>
        {/* Row 1 (6 stars) */}
        <use href="#us-star" x="25" y="24" />
        <use href="#us-star" x="69" y="24" />
        <use href="#us-star" x="113" y="24" />
        <use href="#us-star" x="157" y="24" />
        <use href="#us-star" x="201" y="24" />
        <use href="#us-star" x="245" y="24" />
        {/* Row 2 (5 stars) */}
        <use href="#us-star" x="47" y="50" />
        <use href="#us-star" x="91" y="50" />
        <use href="#us-star" x="135" y="50" />
        <use href="#us-star" x="179" y="50" />
        <use href="#us-star" x="223" y="50" />
        {/* Row 3 (6 stars) */}
        <use href="#us-star" x="25" y="76" />
        <use href="#us-star" x="69" y="76" />
        <use href="#us-star" x="113" y="76" />
        <use href="#us-star" x="157" y="76" />
        <use href="#us-star" x="201" y="76" />
        <use href="#us-star" x="245" y="76" />
        {/* Row 4 (5 stars) */}
        <use href="#us-star" x="47" y="102" />
        <use href="#us-star" x="91" y="102" />
        <use href="#us-star" x="135" y="102" />
        <use href="#us-star" x="179" y="102" />
        <use href="#us-star" x="223" y="102" />
        {/* Row 5 (6 stars) */}
        <use href="#us-star" x="25" y="128" />
        <use href="#us-star" x="69" y="128" />
        <use href="#us-star" x="113" y="128" />
        <use href="#us-star" x="157" y="128" />
        <use href="#us-star" x="201" y="128" />
        <use href="#us-star" x="245" y="128" />
        {/* Row 6 (5 stars) */}
        <use href="#us-star" x="47" y="154" />
        <use href="#us-star" x="91" y="154" />
        <use href="#us-star" x="135" y="154" />
        <use href="#us-star" x="179" y="154" />
        <use href="#us-star" x="223" y="154" />
        {/* Row 7 (6 stars) */}
        <use href="#us-star" x="25" y="180" />
        <use href="#us-star" x="69" y="180" />
        <use href="#us-star" x="113" y="180" />
        <use href="#us-star" x="157" y="180" />
        <use href="#us-star" x="201" y="180" />
        <use href="#us-star" x="245" y="180" />
        {/* Row 8 (5 stars) */}
        <use href="#us-star" x="47" y="206" />
        <use href="#us-star" x="91" y="206" />
        <use href="#us-star" x="135" y="206" />
        <use href="#us-star" x="179" y="206" />
        <use href="#us-star" x="223" y="206" />
        {/* Row 9 (6 stars) */}
        <use href="#us-star" x="25" y="232" />
        <use href="#us-star" x="69" y="232" />
        <use href="#us-star" x="113" y="232" />
        <use href="#us-star" x="157" y="232" />
        <use href="#us-star" x="201" y="232" />
        <use href="#us-star" x="245" y="232" />
      </g>
    </svg>
  )
}
