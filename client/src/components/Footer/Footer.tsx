import { VersionLabel } from "../VersionLabel/VersionLabel";
import styles from "./Footer.module.css";

export const Footer = () => (
  <div className={styles.footer}>
    <div className={styles.footerGroup}>
      <a href="https://graz.io" target="_blank" aria-label="logo" className={styles.logoLink}>
        G
      </a>
      <VersionLabel />
    </div>
  </div>
);
