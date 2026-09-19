import { VersionLabel } from "../VersionLabel/VersionLabel";
import styles from "./Credits.module.css";

export const Credits = () => (
  <div className={styles.credits}>
    <div className={styles.creditsGroup}>
      <a
        href="https://graz.io"
        target="_blank"
        aria-label="logo"
        className={styles.logoLink}
      >
        G
      </a>
      <VersionLabel />
    </div>
    <label className={styles.themeSwitch}>
      <input
        type="checkbox"
        aria-label="Toggle dark mode"
        defaultChecked={document.documentElement.hasAttribute(
          "data-theme-invert",
        )}
        onChange={(e) => {
          document.documentElement.toggleAttribute(
            "data-theme-invert",
            e.target.checked,
          );
          localStorage.setItem("theme-invert", e.target.checked ? "1" : "0");
        }}
      />
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 0C18.6274 0 24 5.37258 24 12C24 18.6274 18.6274 24 12 24C5.37258 24 0 18.6274 0 12C0 5.37258 5.37258 0 12 0ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4V20Z"
          fill="currentColor"
        />
      </svg>
    </label>
  </div>
);
