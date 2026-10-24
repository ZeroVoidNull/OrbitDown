const stack: HTMLElement[] = [];
let overflow = "";
export function pushModal(element: HTMLElement) {
  if (!stack.length) {
    overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  stack.push(element);
}
export function popModal(element: HTMLElement) {
  const i = stack.indexOf(element);
  if (i >= 0) stack.splice(i, 1);
  if (!stack.length) document.body.style.overflow = overflow;
}
export const topModal = (element: HTMLElement) => stack.at(-1) === element;
