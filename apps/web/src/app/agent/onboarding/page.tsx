"use client";

import React, { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import { TRAINING_MODULES, type TrainingModule, type TrainingSection } from "@/lib/training-content";

// ─── Types ────────────────────────────────────────
type View = "module-list" | "section" | "quiz" | "results";

// ─── Component ────────────────────────────────────
const Onboarding: React.FC = () => {
  const router = useRouter();

  // Navigation state
  const [view, setView] = useState<View>("module-list");
  const [currentModuleIndex, setCurrentModuleIndex] = useState(0);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);

  // Progress tracking
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [quizScores, setQuizScores] = useState<Record<string, number>>({});

  // Quiz state
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // Scenario state (within sections)
  const [scenarioAnswered, setScenarioAnswered] = useState<Record<string, number | null>>({});

  // Assignment state
  const [isCompleting, setIsCompleting] = useState(false);
  const [assignmentStatus, setAssignmentStatus] = useState<"" | "assigning" | "assigned" | "full" | "error">("");
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [assignmentDetails, setAssignmentDetails] = useState<any>(null);

  // Current module / section
  const currentModule = TRAINING_MODULES[currentModuleIndex];
  const currentSection = currentModule?.sections[currentSectionIndex];

  const totalSections = useMemo(
    () => TRAINING_MODULES.reduce((sum, m) => sum + m.sections.length, 0),
    []
  );
  const completedSections = useMemo(() => {
    let count = 0;
    for (let i = 0; i < currentModuleIndex; i++) {
      count += TRAINING_MODULES[i].sections.length;
    }
    count += currentSectionIndex;
    return count;
  }, [currentModuleIndex, currentSectionIndex]);
  const globalProgress = Math.round((completedSections / totalSections) * 100);

  // ─── Section Navigation ──────────────────────────
  const goToNextSection = useCallback(() => {
    if (!currentModule) return;
    if (currentSectionIndex < currentModule.sections.length - 1) {
      setCurrentSectionIndex(currentSectionIndex + 1);
    } else {
      // All sections read → go to quiz
      setQuizSubmitted(false);
      setQuizAnswers({});
      setView("quiz");
    }
  }, [currentModule, currentSectionIndex]);

  const goToPrevSection = useCallback(() => {
    if (currentSectionIndex > 0) {
      setCurrentSectionIndex(currentSectionIndex - 1);
    } else if (currentModuleIndex > 0) {
      const prevModule = TRAINING_MODULES[currentModuleIndex - 1];
      setCurrentModuleIndex(currentModuleIndex - 1);
      setCurrentSectionIndex(prevModule.sections.length - 1);
      setView("section");
    }
  }, [currentSectionIndex, currentModuleIndex]);

  // ─── Quiz Logic ──────────────────────────────────
  const handleQuizAnswer = (questionId: string, optionIndex: number) => {
    if (quizSubmitted) return;
    setQuizAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
  };

  const handleQuizSubmit = () => {
    if (!currentModule) return;
    let score = 0;
    for (const q of currentModule.quiz) {
      if (quizAnswers[q.id] === q.correctIndex) score++;
    }
    setQuizScores((prev) => ({ ...prev, [currentModule.id]: score }));
    setQuizSubmitted(true);
  };

  const quizPassed = useMemo(() => {
    if (!currentModule || !quizSubmitted) return false;
    const score = quizScores[currentModule.id] ?? 0;
    return score >= currentModule.minQuizScore;
  }, [currentModule, quizScores, quizSubmitted]);

  const handleQuizNext = () => {
    if (!quizPassed) {
      // Retry
      setQuizSubmitted(false);
      setQuizAnswers({});
      return;
    }
    // Mark module as completed
    if (!completedModules.includes(currentModule.id)) {
      setCompletedModules((prev) => [...prev, currentModule.id]);
    }
    // Go to next module or finish
    if (currentModuleIndex < TRAINING_MODULES.length - 1) {
      setCurrentModuleIndex(currentModuleIndex + 1);
      setCurrentSectionIndex(0);
      setView("section");
    } else {
      setView("results");
    }
  };

  // ─── Finish Training ─────────────────────────────
  const handleFinishTraining = async () => {
    setIsCompleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/agent/login"); return; }

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
        setTimeout(() => router.push("/agent/dashboard"), 4000);
      } else if (assignData.pu_full) {
        setAssignmentStatus("full");
        setAssignmentMessage(assignData.message);
        setAssignmentDetails(assignData);
      } else {
        setAssignmentStatus("error");
        setAssignmentMessage(assignData.message || "Assignment will be handled by admin.");
        setTimeout(() => router.push("/agent/dashboard"), 4000);
      }
    } catch (err) {
      console.error("Error completing training:", err);
      setAssignmentStatus("error");
      setAssignmentMessage("Training saved. Assignment will be handled by admin.");
      setTimeout(() => router.push("/agent/dashboard"), 4000);
    } finally {
      setIsCompleting(false);
    }
  };

  // ─── Render: Module List ─────────────────────────
  if (view === "module-list") {
    return (
      <div className="min-h-screen bg-[var(--color-bg)]">
        <Header
          progress={globalProgress}
          completed={completedModules.length}
          total={TRAINING_MODULES.length}
        />
        <div className="max-w-[640px] mx-auto px-4 py-6">
          <div className="text-center mb-6">
            <h2 className="font-display text-xl font-bold text-[var(--color-text)] mb-1">
              Election Observer Training
            </h2>
            <p className="font-mono text-[11px] text-[var(--color-text-dim)]">
              Complete all 5 modules and pass each quiz to receive your polling unit assignment.
            </p>
          </div>

          <div className="space-y-3">
            {TRAINING_MODULES.map((m, i) => {
              const isCompleted = completedModules.includes(m.id);
              const isCurrent = i === currentModuleIndex && !isCompleted;
              const score = quizScores[m.id];
              const passed = isCompleted && score !== undefined && score >= m.minQuizScore;

              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setCurrentModuleIndex(i);
                    setCurrentSectionIndex(0);
                    setView("section");
                  }}
                  className={`w-full text-left p-4 border transition-colors ${
                    isCompleted
                      ? "border-[var(--color-green)]/30 bg-[var(--color-green-dim)]"
                      : isCurrent
                      ? "border-[var(--color-green)] bg-[var(--color-ink-light)]"
                      : "border-[var(--color-gray-200)] bg-[var(--color-ink-light)] hover:border-[var(--color-green)]/50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl flex-shrink-0">{m.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                          MODULE {i + 1}
                        </span>
                        {isCompleted && (
                          <span className="font-mono text-[9px] px-1.5 py-0.5 bg-[var(--color-green)] text-white">
                            ✓ PASSED {score}/{m.quiz.length}
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-sm text-[var(--color-text)] mt-0.5">
                        {m.title}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-dim)] mt-0.5">
                        {m.subtitle}
                      </div>
                      <div className="font-mono text-[9px] text-[var(--color-text-dim)] mt-1">
                        {m.sections.length} sections · {m.quiz.length} quiz questions · Pass {m.minQuizScore}/{m.quiz.length}
                      </div>
                    </div>
                    <span className="text-[var(--color-text-dim)] text-lg flex-shrink-0">
                      {isCompleted ? "✓" : "→"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Finish button */}
          {completedModules.length === TRAINING_MODULES.length && !assignmentStatus && (
            <div className="mt-6">
              <button
                onClick={handleFinishTraining}
                disabled={isCompleting}
                className="w-full py-4 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50"
              >
                {isCompleting ? "Saving..." : "✓ COMPLETE TRAINING & GET ASSIGNMENT"}
              </button>
            </div>
          )}

          {/* Assignment status */}
          {assignmentStatus && <AssignmentStatus status={assignmentStatus} message={assignmentMessage} details={assignmentDetails} />}
        </div>
      </div>
    );
  }

  // ─── Render: Section View ────────────────────────
  if (view === "section" && currentSection) {
    const scenario = currentSection.scenario;
    const scenarioKey = `${currentModule.id}-${currentSection.id}`;
    const scenarioAnswer = scenarioAnswered[scenarioKey];

    return (
      <div className="min-h-screen bg-[var(--color-bg)]">
        <Header
          progress={globalProgress}
          completed={completedModules.length}
          total={TRAINING_MODULES.length}
        />
        <div className="max-w-[640px] mx-auto px-4 py-6">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-dim)] mb-4">
            <button onClick={() => setView("module-list")} className="hover:text-[var(--color-green)] transition-colors">
              Modules
            </button>
            <span>→</span>
            <span className="text-[var(--color-text)]">{currentModule.title}</span>
            <span>→</span>
            <span className="text-[var(--color-green)]">
              {currentSectionIndex + 1}/{currentModule.sections.length}
            </span>
          </div>

          {/* Section content */}
          <div className="bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] p-5 mb-4">
            <h3 className="font-bold text-base text-[var(--color-text)] mb-3">
              {currentSection.title}
            </h3>

            <div className="space-y-3">
              {currentSection.content.map((para, i) => (
                <p key={i} className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
                  {para}
                </p>
              ))}
            </div>

            {/* Callout */}
            {currentSection.callout && (
              <div className={`mt-4 p-3 border text-[12px] font-mono leading-relaxed ${
                currentSection.calloutType === "warning"
                  ? "border-[var(--color-amber)]/30 bg-[var(--color-amber-dim)] text-[var(--color-amber)]"
                  : currentSection.calloutType === "tip"
                  ? "border-[var(--color-green)]/30 bg-[var(--color-green-dim)] text-[var(--color-green-bright)]"
                  : currentSection.calloutType === "legal"
                  ? "border-[var(--color-blue)]/30 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                  : "border-[var(--color-gray-200)] bg-[var(--color-ink)] text-[var(--color-text-dim)]"
              }`}>
                {currentSection.calloutType === "warning" && "⚠ "}
                {currentSection.calloutType === "tip" && "💡 "}
                {currentSection.calloutType === "legal" && "⚖ "}
                {currentSection.callout}
              </div>
            )}

            {/* Scenario */}
            {scenario && (
              <div className="mt-5 border border-[var(--color-gray-200)] bg-[var(--color-ink)] p-4">
                <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                  🎯 {scenario.title}
                </div>
                <p className="text-[12px] text-[var(--color-text-muted)] mb-3 leading-relaxed">
                  {scenario.description}
                </p>
                <p className="text-[12px] font-bold text-[var(--color-text)] mb-2">
                  {scenario.question}
                </p>

                <div className="space-y-2">
                  {scenario.options.map((opt, i) => {
                    const isSelected = scenarioAnswer === i;
                    const isCorrect = i === scenario.correctIndex;
                    const showResult = scenarioAnswer !== undefined && scenarioAnswer !== null;

                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (scenarioAnswer !== undefined && scenarioAnswer !== null) return;
                          setScenarioAnswered((prev) => ({ ...prev, [scenarioKey]: i }));
                        }}
                        disabled={scenarioAnswer !== undefined && scenarioAnswer !== null}
                        className={`w-full text-left p-3 text-[12px] border transition-colors ${
                          showResult && isCorrect
                            ? "border-[var(--color-green)] bg-[var(--color-green-dim)] text-[var(--color-green-bright)]"
                            : showResult && isSelected && !isCorrect
                            ? "border-[var(--color-red)] bg-[var(--color-red-dim)] text-[var(--color-red-bright)]"
                            : isSelected
                            ? "border-[var(--color-green)] bg-[var(--color-green-dim)]"
                            : "border-[var(--color-gray-200)] hover:border-[var(--color-green)]/50 text-[var(--color-text-muted)]"
                        }`}
                      >
                        <span className="font-mono mr-2">{String.fromCharCode(65 + i)}.</span>
                        {opt}
                      </button>
                    );
                  })}
                </div>

                {/* Explanation after answering */}
                {scenarioAnswer !== undefined && scenarioAnswer !== null && (
                  <div className={`mt-3 p-3 text-[12px] font-mono ${
                    scenarioAnswer === scenario.correctIndex
                      ? "bg-[var(--color-green-dim)] text-[var(--color-green-bright)] border border-[var(--color-green)]/30"
                      : "bg-[var(--color-red-dim)] text-[var(--color-red-bright)] border border-[var(--color-red)]/30"
                  }`}>
                    {scenarioAnswer === scenario.correctIndex ? "✓ Correct! " : "✗ Not quite. "}
                    {scenario.explanation}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex gap-2">
            <button
              onClick={goToPrevSection}
              className="px-4 py-3 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-sm hover:bg-[var(--color-ink-light)] transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={goToNextSection}
              className="flex-1 py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors"
            >
              {currentSectionIndex === currentModule.sections.length - 1
                ? `Quiz: ${currentModule.title}`
                : "Next Section →"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Quiz View ───────────────────────────
  if (view === "quiz" && currentModule) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)]">
        <Header
          progress={globalProgress}
          completed={completedModules.length}
          total={TRAINING_MODULES.length}
        />
        <div className="max-w-[640px] mx-auto px-4 py-6">
          <div className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-dim)] mb-4">
            <button onClick={() => setView("section")} className="hover:text-[var(--color-green)] transition-colors">
              {currentModule.title}
            </button>
            <span>→</span>
            <span className="text-[var(--color-green)]">Quiz</span>
          </div>

          <div className="bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] p-5 mb-4">
            <div className="text-center mb-5">
              <span className="text-3xl">{currentModule.icon}</span>
              <h3 className="font-bold text-lg text-[var(--color-text)] mt-2">
                Knowledge Check
              </h3>
              <p className="text-[12px] text-[var(--color-text-dim)] mt-1">
                Answer all {currentModule.quiz.length} questions. You need at least {currentModule.minQuizScore} correct to pass.
              </p>
            </div>

            <div className="space-y-5">
              {currentModule.quiz.map((q, qi) => (
                <div key={q.id} className="border border-[var(--color-gray-200)] bg-[var(--color-ink)] p-4">
                  <div className="font-mono text-[10px] text-[var(--color-text-dim)] mb-2">
                    QUESTION {qi + 1} OF {currentModule.quiz.length}
                  </div>
                  <p className="text-[13px] font-bold text-[var(--color-text)] mb-3">
                    {q.question}
                  </p>

                  <div className="space-y-2">
                    {q.options.map((opt, oi) => {
                      const isSelected = quizAnswers[q.id] === oi;
                      const isCorrect = oi === q.correctIndex;
                      const showResult = quizSubmitted;

                      return (
                        <button
                          key={oi}
                          onClick={() => handleQuizAnswer(q.id, oi)}
                          disabled={quizSubmitted}
                          className={`w-full text-left p-3 text-[12px] border transition-colors ${
                            showResult && isCorrect
                              ? "border-[var(--color-green)] bg-[var(--color-green-dim)] text-[var(--color-green-bright)]"
                              : showResult && isSelected && !isCorrect
                              ? "border-[var(--color-red)] bg-[var(--color-red-dim)] text-[var(--color-red-bright)]"
                              : isSelected
                              ? "border-[var(--color-green)] bg-[var(--color-green-dim)] text-[var(--color-text)]"
                              : "border-[var(--color-gray-200)] hover:border-[var(--color-green)]/50 text-[var(--color-text-muted)]"
                          }`}
                        >
                          <span className="font-mono mr-2">{String.fromCharCode(65 + oi)}.</span>
                          {opt}
                        </button>
                      );
                    })}
                  </div>

                  {/* Explanation after submit */}
                  {quizSubmitted && (
                    <div className={`mt-3 p-3 text-[12px] font-mono ${
                      quizAnswers[q.id] === q.correctIndex
                        ? "bg-[var(--color-green-dim)] text-[var(--color-green-bright)] border border-[var(--color-green)]/30"
                        : "bg-[var(--color-red-dim)] text-[var(--color-red-bright)] border border-[var(--color-red)]/30"
                    }`}>
                      {quizAnswers[q.id] === q.correctIndex ? "✓ Correct! " : "✗ Incorrect. "}
                      {q.explanation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Submit / Results */}
          {!quizSubmitted ? (
            <button
              onClick={handleQuizSubmit}
              disabled={Object.keys(quizAnswers).length < currentModule.quiz.length}
              className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50"
            >
              Submit Quiz ({Object.keys(quizAnswers).length}/{currentModule.quiz.length} answered)
            </button>
          ) : (
            <div className="space-y-3">
              <div className={`p-4 border text-center ${
                quizPassed
                  ? "border-[var(--color-green)] bg-[var(--color-green-dim)]"
                  : "border-[var(--color-red)] bg-[var(--color-red-dim)]"
              }`}>
                <div className={`text-2xl font-bold font-mono ${
                  quizPassed ? "text-[var(--color-green-bright)]" : "text-[var(--color-red-bright)]"
                }`}>
                  {quizScores[currentModule.id]}/{currentModule.quiz.length}
                </div>
                <div className={`text-sm mt-1 ${
                  quizPassed ? "text-[var(--color-green-bright)]" : "text-[var(--color-red-bright)]"
                }`}>
                  {quizPassed ? "PASSED — Well done!" : `NEED ${currentModule.minQuizScore} TO PASS — Try again`}
                </div>
              </div>

              <button
                onClick={handleQuizNext}
                className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors"
              >
                {quizPassed
                  ? currentModuleIndex < TRAINING_MODULES.length - 1
                    ? "Next Module →"
                    : "See Results"
                  : "Retry Quiz"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Render: Results / All Complete ──────────────
  if (view === "results") {
    return (
      <div className="min-h-screen bg-[var(--color-bg)]">
        <Header progress={100} completed={TRAINING_MODULES.length} total={TRAINING_MODULES.length} />
        <div className="max-w-[640px] mx-auto px-4 py-6">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🎓</div>
            <h2 className="font-display text-xl font-bold text-[var(--color-text)] mb-1">
              Training Complete!
            </h2>
            <p className="font-mono text-[11px] text-[var(--color-text-dim)]">
              You have completed all 5 training modules and passed all quizzes.
            </p>
          </div>

          {/* Score summary */}
          <div className="bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] p-4 mb-4">
            <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-3">
              Your Scores
            </div>
            <div className="space-y-2">
              {TRAINING_MODULES.map((m) => {
                const score = quizScores[m.id] ?? 0;
                const pct = Math.round((score / m.quiz.length) * 100);
                return (
                  <div key={m.id} className="flex items-center gap-3">
                    <span className="text-lg">{m.icon}</span>
                    <div className="flex-1">
                      <div className="text-[12px] text-[var(--color-text)]">{m.title}</div>
                      <div className="h-1.5 bg-[var(--color-gray-200)] mt-1">
                        <div
                          className="h-1.5 bg-[var(--color-green)] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="font-mono text-[12px] font-bold text-[var(--color-green-bright)]">
                      {score}/{m.quiz.length}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* What happens next */}
          <div className="bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] p-4 mb-4">
            <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-3">
              What Happens Next
            </div>
            <div className="space-y-2 text-[12px] text-[var(--color-text-muted)]">
              <div className="flex items-start gap-2">
                <span className="text-[var(--color-green)]">1.</span>
                <span>Your training record is saved as complete</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[var(--color-green)]">2.</span>
                <span>The system checks if your selected polling unit has an open spot</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[var(--color-green)]">3.</span>
                <span>If available, you are assigned as Observer #1 or #2 at your polling unit</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[var(--color-green)]">4.</span>
                <span>If the polling unit is full, alternatives in your ward are suggested</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[var(--color-green)]">5.</span>
                <span>Your assignment details appear on your dashboard</span>
              </div>
            </div>
          </div>

          {!assignmentStatus && (
            <button
              onClick={handleFinishTraining}
              disabled={isCompleting}
              className="w-full py-4 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50"
            >
              {isCompleting ? "Processing..." : "✓ GET MY POLLING UNIT ASSIGNMENT"}
            </button>
          )}

          {assignmentStatus && <AssignmentStatus status={assignmentStatus} message={assignmentMessage} details={assignmentDetails} />}
        </div>
      </div>
    );
  }

  return null;
};

// ─── Header Component ─────────────────────────────
function Header({
  progress,
  completed,
  total,
}: {
  progress: number;
  completed: number;
  total: number;
}) {
  return (
    <div className="bg-[var(--color-green)] text-white px-4 py-3">
      <div className="max-w-[640px] mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-sm">
            NG<span className="opacity-80">EO</span>
          </span>
          <span className="font-mono text-[10px] opacity-70">TRAINING</span>
        </div>
        <span className="font-mono text-[11px]">
          {completed}/{total} modules
        </span>
      </div>
      <div className="max-w-[640px] mx-auto mt-2 bg-white/20 rounded-full h-1.5">
        <div
          className="bg-white h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// ─── Assignment Status Component ──────────────────
function AssignmentStatus({
  status,
  message,
  details,
}: {
  status: string;
  message: string;
  details: any;
}) {
  return (
    <div className="mt-4 space-y-3">
      <div className={`p-4 border text-center ${
        status === "assigning"
          ? "border-blue-300 bg-blue-50 dark:bg-blue-900/20"
          : status === "assigned"
          ? "border-[var(--color-green)] bg-[var(--color-green-dim)]"
          : status === "full"
          ? "border-[var(--color-amber)] bg-[var(--color-amber-dim)]"
          : "border-[var(--color-red)] bg-[var(--color-red-dim)]"
      }`}>
        <div className="text-3xl mb-2">
          {status === "assigning" && "⏳"}
          {status === "assigned" && "✅"}
          {status === "full" && "⚠️"}
          {status === "error" && "📋"}
        </div>
        <div className={`font-bold text-sm ${
          status === "assigning"
            ? "text-blue-700 dark:text-blue-300"
            : status === "assigned"
            ? "text-[var(--color-green-bright)]"
            : status === "full"
            ? "text-[var(--color-amber)]"
            : "text-[var(--color-red-bright)]"
        }`}>
          {status === "assigning" && "Assigning..."}
          {status === "assigned" && "ASSIGNED!"}
          {status === "full" && "PU FULL"}
          {status === "error" && "Pending Assignment"}
        </div>
        <div className="text-[12px] text-[var(--color-text-dim)] mt-1">{message}</div>
      </div>

      {details && status === "assigned" && (
        <div className="p-4 border border-[var(--color-gray-200)] bg-[var(--color-ink-light)]">
          <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
            Your Assignment
          </div>
          <div className="space-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-[var(--color-text-dim)]">Polling Unit</span>
              <span className="font-mono font-bold text-[var(--color-text)]">
                {details.polling_unit?.code}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-dim)]">Name</span>
              <span className="text-right max-w-[60%] text-[var(--color-text-muted)]">
                {details.polling_unit?.name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-dim)]">Observer #</span>
              <span className="font-mono text-[var(--color-text)]">#{details.observer_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-dim)]">Election</span>
              <span className="text-right max-w-[60%] text-[var(--color-text-muted)]">
                {details.election}
              </span>
            </div>
          </div>
        </div>
      )}

      {details && status === "full" && details.alternatives && (
        <div className="p-4 border border-[var(--color-gray-200)] bg-[var(--color-ink-light)]">
          <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
            Available Alternatives
          </div>
          <div className="space-y-2">
            {details.alternatives.map((alt: any) => (
              <div
                key={alt.id}
                className="flex justify-between items-center py-2 border-b border-[var(--color-gray-200)] last:border-0"
              >
                <div>
                  <div className="font-mono text-[13px] font-bold text-[var(--color-text)]">
                    {alt.official_code}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-dim)]">{alt.name}</div>
                </div>
                <div className="text-[11px] text-[var(--color-green-bright)] font-mono">
                  {alt.spots} spot(s)
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {status === "assigned" && (
        <div className="text-center text-[11px] text-[var(--color-text-dim)] font-mono animate-pulse">
          Redirecting to dashboard in 4 seconds...
        </div>
      )}
    </div>
  );
}

export default Onboarding;
