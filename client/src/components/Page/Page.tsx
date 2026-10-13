import type { ReactNode } from "react";
import { Footer } from "@src/components/Footer/Footer";
import styles from "./Page.module.css";

// A one-off page (see pages/site.ts) in the tool pages' column. Children land
// as direct children of the container so they animate in on navigation like a
// tool's options do.
export const Page = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className={styles.container}>
    <h2 className={styles.title}>{title}</h2>
    {children}
    <Footer />
  </div>
);
