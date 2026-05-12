import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { STUDY_TIPS } from "../data/resources";

const INTERVAL_MS = 7000;

export function StudyTipBanner() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % STUDY_TIPS.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const tip = STUDY_TIPS[index];

  return (
    <div className="study-tip-banner" role="status" aria-live="polite">
      <span className="tip-label">Study tip</span>
      <div className="tip-text">
        <AnimatePresence mode="wait">
          <motion.span
            key={tip.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ display: "block" }}
          >
            {tip.text}
          </motion.span>
        </AnimatePresence>
      </div>
      <span aria-hidden="true" style={{ fontSize: "1rem" }}>
        🇲🇾
      </span>
    </div>
  );
}
