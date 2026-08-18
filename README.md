# Seating Planner

A simple classroom seating planner that runs in a web browser. It lets teachers build reusable room layouts, save class lists, set seating rules, and automatically assign students to chairs.

## Website

Use the app here:

https://joshuathorne53.github.io/seating-planner/

## What It Does

- Create and save multiple room layouts
- Place tables, chairs, and teacher desks on a clickable grid
- Save multiple class lists
- Add optional M/F genders to students
- Set seating rules, including:
  - students who cannot sit next to each other
  - students who cannot sit at the same table
  - students who must sit next to each other
  - students who must sit at the same table
  - fixed seats for particular students
  - chairs that should be excluded or always filled
- Optionally auto-assign seats so directly adjacent chairs alternate M/F
- Automatically assign seats while checking that the room has enough suitable tables and chairs
- Manually move students by clicking chairs
- Print seating plans
- Export and import backups so plans can be moved between computers

## How To Use

1. Open the website link above.
2. Create or select a room.
3. Use the grid tools to place tables and chairs.
4. Create or select a class list.
5. Add students, optional M/F genders, and any seating rules.
6. Click **Auto-assign seats** to generate a seating plan.
7. Adjust seats manually if needed.
8. Use **Print** to print the plan, or **Export backup** to save your rooms, classes, rules, and seating plans.

The app saves data in the browser you use. If you switch computers or browsers, use **Export backup** and **Import backup** to move your saved data.

## Installation

No installation is needed if you use the website.

To run it from a computer without using the website:

1. Download this repository as a ZIP file from GitHub.
2. Unzip the folder.
3. Open `index.html` in any modern web browser.

For people using Git:

```bash
git clone https://github.com/joshuathorne53/seating-planner.git
cd seating-planner
open index.html
```

On Windows, double-click `index.html` instead of using the `open` command.

## Notes

- The app works offline after the files are on your computer.
- It does not require a login, server, or database.
- Saved data stays in the browser unless you export a backup.
