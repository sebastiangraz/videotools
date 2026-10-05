import styles from "./Spinner.module.css";

export const Spinner = ({ className }: { className?: string }) => (
  <div
    aria-hidden="true"
    className={className ? `${styles.spinner} ${className}` : styles.spinner}
  />
);
