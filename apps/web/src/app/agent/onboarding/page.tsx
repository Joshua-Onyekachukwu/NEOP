"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

const TRAINING_MODULES = [
  {
    id: "system",
    title: "System Training",
    description: "Learn how to use the observation app",
    icon: "📱",
    content: [
      "How to check in at your polling unit",
      "How to submit results",
      "How to upload evidence photos",
      "How to report incidents",
      "How to use the safety features",
    ],
  },
  {
    id: "observation",
    title: "Observation Protocol",
    description: "What to observe and how to report it",
    icon: "👁️",
    content: [
      "Opening procedures at the polling unit",
      "Voting process observation",
      "Counting process observation",
      "Result announcement observation",
      "What constitutes a complete observation",
    ],
  },
  {
    id: "neutrality",
    title: "Neutrality & Impartiality",
    description: "Maintaining political neutrality",
    icon: "⚖️",
    content: [
      "You must not campaign for any party",
      "You must not promote any candidate",
      "You must not interfere with voting or counting",
      "You must report what you personally observe",
      "You must follow lawful instructions from officials",
    ],
  },
  {
    id: "safety",
    title: "Safety Protocols",
    description: "Your safety comes first",
    icon: "🛡️",
    content: [
      "Do not confront anyone",
      "Leave unsafe situations immediately",
      "Your safety is more important than any data",
      "Use the 'I Feel Unsafe' button if needed",
      "Contact your coordinator for assistance",
    ],
  },
  {
    id: "evidence",
    title: "Evidence Collection",
    description: "How to properly collect and submit evidence",
    icon: "📷",
    content: [
      "Photograph only where lawful and safe",
      "Never photograph secret ballots",
      "Never expose voter choices",
      "Ensure photos are clear and readable",
      "Submit evidence promptly after observation",
    ],
  },
];

const Onboarding: React.FC = () => {
  const router = useRouter();
  const [currentModule, setCurrentModule] = useState(0);
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [isCompleting, setIsCompleting] = useState(false);

  const handleCompleteModule = (moduleId: string) => {
    if (!completedModules.includes(moduleId)) {
      setCompletedModules([...completedModules, moduleId]);
    }
    if (currentModule < TRAINING_MODULES.length - 1) {
      setCurrentModule(currentModule + 1);
    }
  };

  const [assignmentStatus, setAssignmentStatus] = useState<"" | "assigning" | "assigned" | "full" | "error">("");
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [assignmentDetails, setAssignmentDetails] = useState<any>(null);

  const handleFinishTraining = async () => {
    setIsCompleting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/agent/login");
        return;
      }

      // 1. Mark training as complete
      const { data: volunteer } = await supabase
        .from("volunteers")
        .select("id")
        .eq("user_id", session.user.id)
        .single();

      if (volunteer) {
        await supabase
          .from("volunteers")
          .update({
            training_status: "COMPLETED",
            training_completed_at: new Date().toISOString(),
          })
          .eq("id", volunteer.id);
      }

      // 2. Auto-assign to polling unit
      setAssignmentStatus("assigning");
      setAssignmentMessage("Assigning you to your polling unit...");

      const assignRes = await fetch("/api/me/auto-assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const assignData = await assignRes.json();

      if (assignData.success) {
        setAssignmentStatus("assigned");
        setAssignmentMessage(assignData.message);
        setAssignmentDetails(assignData);
        // Redirect to dashboard after 3 seconds
        setTimeout(() => router.push("/agent/dashboard"), 3000);
      } else if (assignData.pu_full) {
        setAssignmentStatus("full");
        setAssignmentMessage(assignData.message);
        setAssignmentDetails(assignData);
      } else {
        setAssignmentStatus("error");
        setAssignmentMessage(assignData.message || "Assignment will be handled by admin");
        // Still go to dashboard
        setTimeout(() => router.push("/agent/dashboard"), 3000);
      }
    } catch (err) {
      console.error("Error completing training:", err);
      setAssignmentStatus("error");
      setAssignmentMessage("Training saved. Assignment will be handled by admin.");
      setTimeout(() => router.push("/agent/dashboard"), 3000);
    } finally {
      setIsCompleting(false);
    }
  };

  const currentModuleData = TRAINING_MODULES[currentModule];
  const progress = (completedModules.length / TRAINING_MODULES.length) * 100;

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-[#0a0e19]">
      {/* Header */}
      <div className="bg-primary-600 text-white px-[20px] py-[15px]">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Training</h1>
          <span className="text-sm">
            {completedModules.length}/{TRAINING_MODULES.length} modules
          </span>
        </div>
        <div className="mt-[10px] bg-white/20 rounded-full h-2">
          <div
            className="bg-white h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      <div className="container mx-auto px-[12px] py-[20px] max-w-[600px]">
        {/* Module selector */}
        <div className="flex gap-[10px] mb-[20px] overflow-x-auto pb-[10px]">
          {TRAINING_MODULES.map((m, index) => (
            <button
              key={m.id}
              onClick={() => setCurrentModule(index)}
              className={`flex-shrink-0 px-[12px] py-[8px] rounded-[8px] text-sm font-medium transition-colors ${
                currentModule === index
                  ? "bg-primary-500 text-white"
                  : completedModules.includes(m.id)
                  ? "bg-green-100 text-green-800"
                  : "bg-white dark:bg-[#1c1c1c] border border-gray-200 dark:border-[#202c4b] text-gray-700 dark:text-gray-300"
              }`}
            >
              {completedModules.includes(m.id) ? "✓" : ""} {m.icon}
            </button>
          ))}
        </div>

        {/* Current module */}
        <div className="bg-white dark:bg-[#1c1c1c] rounded-[12px] border border-gray-200 dark:border-[#202c4b] shadow-sm p-[20px]">
          <div className="text-center mb-[20px]">
            <span className="text-4xl">{currentModuleData.icon}</span>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mt-[10px]">
              {currentModuleData.title}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-[5px]">
              {currentModuleData.description}
            </p>
          </div>

          <div className="space-y-[12px] mb-[20px]">
            {currentModuleData.content.map((item, index) => (
              <div
                key={index}
                className="flex items-start gap-3 p-[12px] bg-gray-50 dark:bg-[#161616] rounded-[8px]"
              >
                <span className="text-primary-500 font-bold">{index + 1}.</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">{item}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-[12px]">
            {currentModule > 0 && (
              <button
                onClick={() => setCurrentModule(currentModule - 1)}
                className="flex-1 px-[20px] py-[12px] border border-gray-300 dark:border-[#202c4b] text-gray-700 dark:text-gray-300 rounded-[10px] font-medium hover:bg-gray-50 dark:hover:bg-[#161616] transition-colors"
              >
                Previous
              </button>
            )}
            <button
              onClick={() => handleCompleteModule(currentModuleData.id)}
              className="flex-1 px-[20px] py-[12px] bg-primary-500 text-white rounded-[10px] font-bold hover:bg-primary-600 transition-colors"
            >
              {currentModule === TRAINING_MODULES.length - 1
                ? completedModules.includes(currentModuleData.id)
                  ? "Completed ✓"
                  : "Complete Module"
                : "Next Module"}
            </button>
          </div>
        </div>

        {/* Finish button */}
        {completedModules.length === TRAINING_MODULES.length && !assignmentStatus && (
          <div className="mt-[20px]">
            <button
              onClick={handleFinishTraining}
              disabled={isCompleting}
              className="w-full px-[20px] py-[15px] bg-green-600 text-white rounded-[10px] font-bold hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {isCompleting ? "Saving..." : "✓ Complete Training & Get Assignment"}
            </button>
          </div>
        )}

        {/* Assignment status */}
        {assignmentStatus && (
          <div className="mt-[20px] space-y-3">
            <div className={`p-4 rounded-[10px] border text-center ${
              assignmentStatus === "assigning"
                ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
                : assignmentStatus === "assigned"
                ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
                : assignmentStatus === "full"
                ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800"
                : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
            }`}>
              <div className="text-3xl mb-2">
                {assignmentStatus === "assigning" && "⏳"}
                {assignmentStatus === "assigned" && "✅"}
                {assignmentStatus === "full" && "⚠️"}
                {assignmentStatus === "error" && "❌"}
              </div>
              <div className="font-bold text-sm text-[#06201B] dark:text-white">
                {assignmentStatus === "assigning" && "Assigning..."}
                {assignmentStatus === "assigned" && "ASSIGNED!"}
                {assignmentStatus === "full" && "PU FULL"}
                {assignmentStatus === "error" && "Pending Assignment"}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                {assignmentMessage}
              </div>
            </div>

            {/* Assignment details */}
            {assignmentDetails && assignmentStatus === "assigned" && (
              <div className="p-4 bg-white dark:bg-[#1c1c1c] rounded-[10px] border border-gray-200 dark:border-[#202c4b]">
                <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Your Assignment</div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Polling Unit</span>
                    <span className="font-mono font-bold">{assignmentDetails.polling_unit?.code}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Name</span>
                    <span className="text-right max-w-[60%]">{assignmentDetails.polling_unit?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Observer #</span>
                    <span className="font-mono">#{assignmentDetails.observer_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Election</span>
                    <span className="text-right max-w-[60%]">{assignmentDetails.election}</span>
                  </div>
                </div>
              </div>
            )}

            {/* PU full alternatives */}
            {assignmentDetails && assignmentStatus === "full" && assignmentDetails.alternatives && (
              <div className="p-4 bg-white dark:bg-[#1c1c1c] rounded-[10px] border border-gray-200 dark:border-[#202c4b]">
                <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Available Alternatives</div>
                <div className="space-y-2">
                  {assignmentDetails.alternatives.map((alt: any) => (
                    <div key={alt.id} className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-[#202c4b] last:border-0">
                      <div>
                        <div className="font-mono text-sm font-bold">{alt.official_code}</div>
                        <div className="text-xs text-gray-500">{alt.name}</div>
                      </div>
                      <div className="text-xs text-green-600 font-mono">{alt.spots} spot(s)</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-xs text-gray-500 text-center">
                  Contact admin to be reassigned to an alternative PU
                </div>
              </div>
            )}

            {/* Redirecting message */}
            {assignmentStatus === "assigned" && (
              <div className="text-center text-xs text-gray-500 font-mono animate-pulse">
                Redirecting to dashboard in 3 seconds...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
