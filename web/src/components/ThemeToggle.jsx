import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { ACCENTS, MODES, useTheme } from '../lib/theme.jsx';
import { Button } from './ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.jsx';

const ICONE_MODE = { light: Sun, dark: Moon, system: Monitor };

/**
 * Réglage du thème : mode clair / sombre / système, et teinte d'accent.
 *
 * La teinte se choisit sur une pastille et non dans une liste de noms : ce
 * qu'on veut voir, c'est la couleur elle-même. Chaque pastille reste doublée de
 * son nom en infobulle et en libellé accessible — la couleur seule ne peut pas
 * porter l'information.
 */
export function ThemeToggle({ align = 'start', side = 'top' }) {
  const { mode, accent, setMode, setAccent } = useTheme();
  const Icone = ICONE_MODE[mode] || Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2.5 px-2">
          <Icone aria-hidden="true" />
          <span className="flex-1 text-left">Apparence</span>
          <span
            className="size-3.5 rounded-full border border-border"
            style={{ background: 'hsl(var(--accent-h) var(--accent-s) 45%)' }}
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={align} side={side} className="w-56">
        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={setMode}>
          {MODES.map((option) => {
            const OptionIcone = ICONE_MODE[option.value];
            return (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <OptionIcone className="size-3.5" aria-hidden="true" />
                {option.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="flex items-center gap-1.5">
          <Palette className="size-3" aria-hidden="true" />
          Couleur
        </DropdownMenuLabel>
        {/* Les pastilles sortent du flux du menu : une grille se parcourt aux
            quatre flèches, ce que la liste verticale de Radix ne fait pas. */}
        <div className="grid grid-cols-7 gap-1 px-2 pb-1.5 pt-1">
          {ACCENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setAccent(option.value)}
              title={option.label}
              aria-label={`Teinte ${option.label}`}
              aria-pressed={accent === option.value}
              className={
                'size-5 rounded-full border transition-transform hover:scale-110 ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                'focus-visible:ring-offset-2 focus-visible:ring-offset-popover ' +
                (accent === option.value
                  ? 'border-foreground/70 scale-110'
                  : 'border-border')
              }
              style={{ background: `hsl(${option.hue} ${option.sat}% 45%)` }}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
