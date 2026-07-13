import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export default function AnimatedCounter({ value, suffix = '', decimals = 1 }: { value: number; suffix?: string; decimals?: number }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const duration = 800;
    const steps = 30;
    const increment = (value - display) / steps;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setDisplay((prev) => prev + increment);
      if (i >= steps) {
        setDisplay(value);
        clearInterval(timer);
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      {display.toFixed(decimals)}{suffix}
    </motion.span>
  );
}
