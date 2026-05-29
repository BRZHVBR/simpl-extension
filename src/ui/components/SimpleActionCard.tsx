import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  SimpleInstrumentIcon,
  type SimpleInstrument,
} from "../../popup/components/SimpleInstrumentIcon";

type SimpleActionCardProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  title: string;
  description?: string;
  instrument?: SimpleInstrument;
};

export function SimpleActionCard({
  icon,
  title,
  description,
  instrument,
  className = "",
  ...props
}: SimpleActionCardProps) {
  return (
    <button className={`simple-action-card ${className}`} {...props}>
      {instrument ? (
        <SimpleInstrumentIcon instrument={instrument} />
      ) : icon ? (
        <span className="simple-action-card__icon">{icon}</span>
      ) : null}

      <span className="simple-action-card__body">
        <span className="simple-action-card__title">{title}</span>
        {description ? (
          <span className="simple-action-card__description">{description}</span>
        ) : null}
      </span>

      <span className="simple-action-card__arrow">→</span>
    </button>
  );
}
