import React from "react";

/**
 * Vitauri "A" app mark — fixed brand colors (not tenant-themed).
 * Squircle background with a split-color bold "A": left half white, right half light blue.
 */
export default function AppLogo({ size = 32, rounded = "22%", className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Vitauri KYC"
    >
      <rect width="100" height="100" rx="22" fill="#2956E0" />
      <clipPath id="appLogoLeftHalf">
        <rect x="0" y="0" width="50" height="100" />
      </clipPath>
      <clipPath id="appLogoRightHalf">
        <rect x="50" y="0" width="50" height="100" />
      </clipPath>
      <text
        x="50"
        y="72"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="800"
        fontSize="70"
        fill="#FFFFFF"
        clipPath="url(#appLogoLeftHalf)"
      >
        A
      </text>
      <text
        x="50"
        y="72"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="800"
        fontSize="70"
        fill="#74A4F7"
        clipPath="url(#appLogoRightHalf)"
      >
        A
      </text>
    </svg>
  );
}