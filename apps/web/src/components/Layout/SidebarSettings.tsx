"use client";

import React, { useState, useEffect } from "react";

const SidebarSettings: React.FC = () => {
  // Light/Dark Mode
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  useEffect(() => {
    // Retrieve the user's preference from local storage
    const storedPreference = localStorage.getItem("theme");
    if (storedPreference === "dark") {
      setIsDarkMode(true);
    }
  }, []);

  const handleToggle = () => {
    setIsDarkMode(!isDarkMode);
  };

  useEffect(() => {
    // Update the user's preference in local storage
    localStorage.setItem("theme", isDarkMode ? "dark" : "light");

    // Update the class on the <html> element to apply the selected mode
    const htmlElement = document.querySelector("html");
    if (htmlElement) {
      if (isDarkMode) {
        htmlElement.classList.add("dark");
      } else {
        htmlElement.classList.remove("dark");
      }
    }
  }, [isDarkMode]);

  // RTL/LTR
  const [dirAttribute, setDirAttribute] = useState<string>("ltr");

  useEffect(() => {
    const storedDirAttribute = localStorage.getItem("dirAttribute");
    if (storedDirAttribute) {
      setDirAttribute(storedDirAttribute);
      document.documentElement.setAttribute("dir", storedDirAttribute);
    }
  }, []);

  const handleButtonClick = () => {
    const newDirAttribute = dirAttribute === "ltr" ? "rtl" : "ltr";
    setDirAttribute(newDirAttribute);
    localStorage.setItem("dirAttribute", newDirAttribute);
    document.documentElement.setAttribute("dir", newDirAttribute);
  };

  return (
    <>
      <div className="sidebar-settings fixed top-1/2 -translate-y-1/2 ltr:right-0 rtl:left-0 bg-white dark:bg-[#0a0e19] ltr:rounded-l-[10px] rtl:rounded-r-[10px] border border-gray-100 dark:border-[#202c4b] ltr:border-r-0 rtl:border-l-0 shadow-md z-[9] p-[10px] md:p-[15px]">
        <button
          type="button"
          className="light-dark-toggle leading-none transition-all text-black dark:text-white font-medium flex items-center gap-[10px]"
          onClick={handleToggle}
        >
          Light/Dark:
          <i className="ri-sun-line !text-[20px] md:!text-[22px] text-[#fe7a36]"></i>
        </button>

        <button
          type="button"
          className="rtl-mode-toggle flex items-center text-black dark:text-white font-medium mt-[10px] gap-[10px]"
          onClick={handleButtonClick}
        >
          LTR/RTL:
          <span className="inline-block relative rounded-full w-[35px] h-[20px] bg-gray-50 dark:bg-[#0a0e19]">
            <span className="inline-block transition-all absolute h-[12px] w-[12px] bg-black dark:bg-white rounded-full top-1/2 -translate-y-1/2"></span>
          </span>
        </button>
      </div>
    </>
  );
};

export default SidebarSettings;
