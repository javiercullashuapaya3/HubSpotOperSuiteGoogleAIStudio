import React from 'react';

interface PromptiaLogoProps {
  variant?: 'icon' | 'horizontal' | 'full';
  size?: number | string;
  className?: string;
  showText?: boolean;
}

export const PromptiaLogo: React.FC<PromptiaLogoProps> = ({
  variant = 'horizontal',
  size = 36,
  className = '',
  showText = true,
}) => {
  // If icon-only variant
  if (variant === 'icon') {
    return (
      <svg
        viewBox="0 0 500 460"
        width={size}
        height={size}
        className={`shrink-0 ${className}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Promptia.lat Logo"
      >
        <defs>
          <linearGradient id="pCyanGradIcon" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00E5FF" />
            <stop offset="45%" stopColor="#00A3FF" />
            <stop offset="100%" stopColor="#2563EB" />
          </linearGradient>

          <linearGradient id="pPurpleGradIcon" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="50%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#A855F7" />
          </linearGradient>
        </defs>

        <g transform="translate(-160, -100)">
          {/* Left Brain Outline */}
          <path
            d="M 390 140
               C 335 140, 275 165, 250 215
               C 220 225, 205 255, 210 295
               C 200 320, 205 365, 230 395
               C 220 420, 230 460, 260 485
               C 300 520, 360 525, 390 500"
            fill="none"
            stroke="url(#pCyanGradIcon)"
            strokeWidth="26"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Middle lobe indent */}
          <path
            d="M 215 315
               C 245 320, 265 345, 260 380"
            fill="none"
            stroke="url(#pCyanGradIcon)"
            strokeWidth="22"
            strokeLinecap="round"
          />

          {/* Top circuit branch */}
          <path
            d="M 365 240 L 295 295"
            fill="none"
            stroke="url(#pCyanGradIcon)"
            strokeWidth="22"
            strokeLinecap="round"
          />
          <circle cx="365" cy="240" r="22" fill="url(#pCyanGradIcon)" />
          <circle cx="295" cy="295" r="22" fill="url(#pCyanGradIcon)" />

          {/* Bottom circuit branch */}
          <path
            d="M 360 440 L 330 480"
            fill="none"
            stroke="url(#pCyanGradIcon)"
            strokeWidth="22"
            strokeLinecap="round"
          />
          <circle cx="360" cy="440" r="22" fill="url(#pCyanGradIcon)" />

          {/* Letter I */}
          <rect
            x="440"
            y="215"
            width="34"
            height="135"
            rx="8"
            fill="url(#pPurpleGradIcon)"
          />

          {/* Circuit trace extending from I */}
          <path
            d="M 457 348
               L 457 395
               L 510 445
               L 480 495
               L 460 515"
            fill="none"
            stroke="url(#pPurpleGradIcon)"
            strokeWidth="24"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="460" cy="515" r="24" fill="url(#pPurpleGradIcon)" />

          {/* Letter A */}
          <path
            d="M 525 350 L 570 215"
            stroke="url(#pPurpleGradIcon)"
            strokeWidth="36"
            strokeLinecap="round"
          />
          <path
            d="M 570 215 L 615 350"
            stroke="url(#pPurpleGradIcon)"
            strokeWidth="36"
            strokeLinecap="round"
          />
          <path
            d="M 545 305 L 595 305"
            stroke="url(#pPurpleGradIcon)"
            strokeWidth="28"
            strokeLinecap="round"
          />
        </g>
      </svg>
    );
  }

  // Horizontal variant (Emblem + text side-by-side)
  if (variant === 'horizontal') {
    return (
      <div className={`flex items-center gap-2.5 ${className}`}>
        {/* Emblem */}
        <div className="relative shrink-0 flex items-center justify-center">
          <PromptiaLogo variant="icon" size={size} />
        </div>

        {/* Text */}
        {showText && (
          <div className="flex flex-col leading-none">
            <span className="font-extrabold tracking-tight text-[15px] sm:text-base flex items-baseline">
              <span className="text-[#00C4FF] font-black">Promptia</span>
              <span className="text-[#9333EA] font-black">.lat</span>
            </span>
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase mt-0.5">
              HubOps Suite
            </span>
          </div>
        )}
      </div>
    );
  }

  // Full stacked variant (Emblem on top, text underneath)
  return (
    <div className={`flex flex-col items-center text-center ${className}`}>
      <PromptiaLogo variant="icon" size={typeof size === 'number' ? size * 1.5 : size} />
      {showText && (
        <div className="mt-2.5 flex items-baseline justify-center">
          <span className="text-2xl sm:text-3xl font-black text-[#00C4FF] tracking-tight">Promptia</span>
          <span className="text-2xl sm:text-3xl font-black text-[#9333EA] tracking-tight">.lat</span>
        </div>
      )}
    </div>
  );
};
