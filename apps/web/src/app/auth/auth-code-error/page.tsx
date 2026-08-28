"use client";

import React from "react";
import Link from "next/link";

const AuthCodeError: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-[#0a0e19] flex items-center justify-center p-[20px]">
      <div className="text-center max-w-[400px]">
        <div className="text-5xl mb-[20px]">⚠️</div>
        <h1 className="text-xl font-bold text-[#06201B] dark:text-white mb-[10px]">
          Authentication Error
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-[20px]">
          There was an error signing you in. Please try again.
        </p>
        <Link
          href="/agent/login"
          className="inline-block px-[20px] py-[12px] bg-primary-500 text-white rounded-[10px] font-bold hover:bg-primary-600 transition-colors"
        >
          Try Again
        </Link>
      </div>
    </div>
  );
};

export default AuthCodeError;
