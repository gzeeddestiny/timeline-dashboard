import { UI_EMOJI } from "../lib/uiEmoji"

export default function Emoji({ name }) {
  return <span aria-hidden="true">{UI_EMOJI[name]}</span>
}
