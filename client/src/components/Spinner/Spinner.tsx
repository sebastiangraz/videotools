import styles from "./Spinner.module.css";

// Four dots chasing each other round a square, in the text colour of wherever
// it sits. Decoration only: whatever is busy says so itself (the action
// button's status text, the mark preview's aria-busy). `className` places it.
export const Spinner = ({ className }: { className?: string }) => (
  <div
    aria-hidden="true"
    className={className ? `${styles.spinner} ${className}` : styles.spinner}
  />
);
