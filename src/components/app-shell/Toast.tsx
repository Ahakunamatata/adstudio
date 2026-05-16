"use client";

type ToastProps = {
  text: string;
  visible: boolean;
};

export function Toast({ text, visible }: ToastProps) {
  return <div className={`toast ${visible ? "is-visible" : ""}`}>{text}</div>;
}
