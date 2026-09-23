import type { ReactNode } from "react";
import { Footer } from "../Footer/Footer";
import styles from "./Page.module.css";

// The frame for a one-off page (see pages/site.ts): a heading and the page's
// content in the same bordered column the tool pages use, with the footer at
// the bottom. Children land as direct children of the container so they
// animate in on navigation like a tool's options do.
export const Page = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <div className={styles.container}>
    <h2 className={styles.title}>{title}</h2>
    {children}
    <Footer />
  </div>
);
