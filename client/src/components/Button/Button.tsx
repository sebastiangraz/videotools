import type { ComponentProps } from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { cx } from "@src/helpers";
import styles from "./Button.module.css";

export const Button = ({
  variant = "primary",
  className,
  ...props
}: Omit<ComponentProps<typeof BaseButton>, "className"> & {
  variant?: "primary" | "secondary";
  className?: string;
}) => <BaseButton {...props} data-variant={variant} className={cx(styles.button, className)} />;
