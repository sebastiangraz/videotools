import { cx } from "../../helpers";
import styles from "./Spinner.module.css";

export const Spinner = ({ className }: { className?: string }) => (
  <div aria-hidden="true" className={cx(styles.spinner, className)} />
);
