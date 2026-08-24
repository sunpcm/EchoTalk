import React from "react";

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export const Button = ({ children, onClick, className = "" }: ButtonProps) => {
  return (
    <button
      onClick={onClick}
      className={`rounded bg-green-500 px-4 py-2 text-white transition-colors hover:bg-green-600 ${className}`}
    >
      {children}
    </button>
  );
};
