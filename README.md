# NoisFit

App (PWA) de treino, dieta, água, desafios em grupo e avaliação física. Roda no navegador do celular e pode ser instalado na tela inicial. Backend: Supabase.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | página e estilos |
| `app.js` | telas e navegação |
| `api.js` | conexão com o Supabase (URL, chave publishable e chave pública do push) |
| `sw.js` | funciona offline e recebe notificações |
| `manifest.webmanifest`, `icons/` | instalação na tela inicial |
| `supabase.min.js` | biblioteca do Supabase (supabase-js 2.118.0) |
| `supabase/01_banco.sql` | banco: tabelas, regras de acesso, pontuação, encerramento, agendamentos |

## Regras de nota

- **Dieta (por dia):** calorias dentro de ±10% da meta = 5; cada macro (P, C, G) dentro de ±10% = 5/3. Máx. 10.
- **Treino (por dia):** com foto de comprovação = 10; sem foto = 5; sem treino = 0.
- **Água (por dia):** 10 × (consumido ÷ meta), máx. 10.
- **Nota final:** cada pilar vira 0–100; Final = (Dieta + Treino + Água + 2 × Avaliação) ÷ 5. Quem não lança avaliação final fica com zero na avaliação.
- A pontuação é calculada **no banco**; ninguém consegue editar a própria nota.
- Registros (treino, refeição, água) só podem ser lançados ou alterados para **hoje e ontem**.
- Entrada nos desafios **só com o código de convite** de quem criou.

## Publicação

Ver o passo a passo enviado na conversa (GitHub Pages + configuração de URL no Supabase).

## Privacidade

- Perfil, medidas, refeições, água e exames: só o próprio usuário vê.
- Fotos de treino e refeição: o dono e quem participa de algum desafio com ele.
- Exames de bioimpedância: só o dono.
- A análise da IA não substitui nutricionista ou educador físico.
